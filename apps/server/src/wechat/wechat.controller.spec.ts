import { RawBodyRequest } from '@nestjs/common';
import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LeasesService } from '../leases/leases.service';
import { IWechatCustomerServiceService } from './wechat-customer-service.interface';
import { WechatEventService } from './wechat-event.service';
import { WechatController } from './wechat.controller';

const TEST_TOKEN = 'test-token';
const TIMESTAMP = '1735689600';
const NONCE = 'abc123';

function sign(token: string, timestamp: string, nonce: string): string {
  return createHash('sha1')
    .update([token, timestamp, nonce].sort().join(''))
    .digest('hex');
}

describe('WechatController contract signing events', () => {
  let prisma: jest.Mocked<PrismaService>;
  let customerService: jest.Mocked<IWechatCustomerServiceService>;
  let leasesService: jest.Mocked<LeasesService>;
  let controller: WechatController;
  const originalToken = process.env.WECHAT_TOKEN;
  const validSignature = sign(TEST_TOKEN, TIMESTAMP, NONCE);

  beforeEach(() => {
    process.env.WECHAT_TOKEN = TEST_TOKEN;
    prisma = {
      contractSigningTask: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      tenant: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;
    process.env.SERVER_PUBLIC_BASE_URL = 'https://dev.landlordeasy.cn/api/v1';
    customerService = { sendTextMessage: jest.fn() };
    leasesService = {
      launchContractSigningTask: jest.fn(),
      tryConfirmSigned: jest.fn(),
    } as unknown as jest.Mocked<LeasesService>;
    controller = new WechatController(
      prisma,
      new WechatEventService(),
      customerService,
      leasesService,
    );
  });

  afterAll(() => {
    if (originalToken === undefined) delete process.env.WECHAT_TOKEN;
    else process.env.WECHAT_TOKEN = originalToken;
  });

  function request(xml: string): RawBodyRequest<Request> {
    return { rawBody: Buffer.from(xml) } as RawBodyRequest<Request>;
  }

  function response(): { value: Response; send: jest.Mock } {
    const value = {
      status: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    } as unknown as Response;
    return { value, send: value.send as jest.Mock };
  }

  /** 带上通过签名校验所需的 signature/timestamp/nonce,模拟微信真实推送。 */
  function postEvent(xml: string, res: Response) {
    return controller.event(validSignature, TIMESTAMP, NONCE, request(xml), res);
  }

  it.each([
    ['subscribe', 'qrscene_123'],
    ['SCAN', '123'],
  ])('%s 事件按场景值转为 FOLLOWED 后自动发起签署', async (event, eventKey) => {
    const xml =
      `<xml><FromUserName><![CDATA[openid-1]]></FromUserName>` +
      `<MsgType><![CDATA[event]]></MsgType><Event><![CDATA[${event}]]></Event>` +
      `<EventKey><![CDATA[${eventKey}]]></EventKey></xml>`;
    (prisma.contractSigningTask.findFirst as jest.Mock).mockResolvedValue({
      id: 9,
      lease: { room: { roomNo: '205', building: { name: 'R栋' } } },
    });
    (prisma.contractSigningTask.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    customerService.sendTextMessage.mockResolvedValue(true);
    const res = response();

    await postEvent(xml, res.value);

    expect(prisma.contractSigningTask.findFirst).toHaveBeenCalledWith({
      where: { sceneValue: 123, status: 'PENDING_SCAN' },
      select: {
        id: true,
        lease: { select: { room: { select: { roomNo: true, building: { select: { name: true } } } } } },
      },
    });
    expect(prisma.contractSigningTask.updateMany).toHaveBeenCalledWith({
      where: { id: 9, status: 'PENDING_SCAN' },
      data: { status: 'FOLLOWED', followerOpenid: 'openid-1' },
    });
    expect(leasesService.launchContractSigningTask).toHaveBeenCalledWith(9, {});
    expect(customerService.sendTextMessage).not.toHaveBeenCalled();
    expect(res.value.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('success');
  });

  it('自动发起失败时发送确认消息且 webhook 仍返回 200', async () => {
    const xml =
      '<xml><FromUserName><![CDATA[openid-1]]></FromUserName>' +
      '<MsgType><![CDATA[event]]></MsgType><Event><![CDATA[subscribe]]></Event>' +
      '<EventKey><![CDATA[qrscene_123]]></EventKey></xml>';
    (prisma.contractSigningTask.findFirst as jest.Mock).mockResolvedValue({
      id: 9,
      lease: { room: { roomNo: '205', building: { name: 'R栋' } } },
    });
    (prisma.contractSigningTask.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    leasesService.launchContractSigningTask.mockRejectedValue(
      new Error('微签暂不可用'),
    );
    customerService.sendTextMessage.mockResolvedValue(true);
    const res = response();

    await expect(postEvent(xml, res.value)).resolves.toBeUndefined();

    expect(prisma.contractSigningTask.updateMany).toHaveBeenCalledWith({
      where: { id: 9, status: 'PENDING_SCAN' },
      data: { status: 'FOLLOWED', followerOpenid: 'openid-1' },
    });
    expect(leasesService.launchContractSigningTask).toHaveBeenCalledWith(9, {});
    expect(customerService.sendTextMessage).toHaveBeenCalledWith(
      'openid-1',
      '【R栋205】您已成功关注,该房源的租房合同已进入待签约状态,房东确认后将自动发起电子签约,请留意后续消息',
    );
    expect(res.value.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('success');
  });

  it('场景值未匹配时发送默认欢迎语', async () => {
    (prisma.contractSigningTask.findFirst as jest.Mock).mockResolvedValue(null);
    customerService.sendTextMessage.mockResolvedValue(true);
    const res = response();

    await postEvent(
      '<xml><FromUserName>openid-2</FromUserName><MsgType>event</MsgType>' +
        '<Event>subscribe</Event><EventKey>qrscene_456</EventKey></xml>',
      res.value,
    );

    expect(customerService.sendTextMessage).toHaveBeenCalledWith(
      'openid-2',
      '欢迎关注,如有问题请联系房东',
    );
    expect(res.send).toHaveBeenCalledWith('success');
  });

  it('内部依赖抛错时仍向微信返回 200 success', async () => {
    (prisma.contractSigningTask.findFirst as jest.Mock).mockRejectedValue(
      new Error('database unavailable'),
    );
    const res = response();

    await expect(
      postEvent(
        '<xml><FromUserName>openid-3</FromUserName><MsgType>event</MsgType>' +
          '<Event>SCAN</Event><EventKey>789</EventKey></xml>',
        res.value,
      ),
    ).resolves.toBeUndefined();
    expect(res.value.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('success');
  });

  it('场景值匹配租客绑定场景值时,首次关注自动绑定 openid 并推送链接', async () => {
    (prisma.contractSigningTask.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.tenant.findFirst as jest.Mock).mockResolvedValue({ id: 5, openid: null });
    customerService.sendTextMessage.mockResolvedValue(true);
    const res = response();

    await postEvent(
      '<xml><FromUserName><![CDATA[openid-tenant]]></FromUserName>' +
        '<MsgType><![CDATA[event]]></MsgType><Event><![CDATA[subscribe]]></Event>' +
        '<EventKey><![CDATA[qrscene_321]]></EventKey></xml>',
      res.value,
    );

    expect(prisma.tenant.findFirst).toHaveBeenCalledWith({
      where: { bindSceneValue: 321 },
      select: { id: true, openid: true },
    });
    expect(prisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { openid: 'openid-tenant' },
    });
    expect(customerService.sendTextMessage).toHaveBeenCalledWith(
      'openid-tenant',
      expect.stringContaining('https://dev.landlordeasy.cn/tenant/'),
    );
    expect(res.send).toHaveBeenCalledWith('success');
  });

  it('租客绑定场景值已绑定其他 openid 时,不覆盖已有绑定', async () => {
    (prisma.contractSigningTask.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.tenant.findFirst as jest.Mock).mockResolvedValue({
      id: 5,
      openid: 'openid-original',
    });
    customerService.sendTextMessage.mockResolvedValue(true);
    const res = response();

    await postEvent(
      '<xml><FromUserName><![CDATA[openid-other]]></FromUserName>' +
        '<MsgType><![CDATA[event]]></MsgType><Event><![CDATA[scan]]></Event>' +
        '<EventKey><![CDATA[321]]></EventKey></xml>',
      res.value,
    );

    expect(prisma.tenant.update).not.toHaveBeenCalled();
    expect(customerService.sendTextMessage).toHaveBeenCalledWith(
      'openid-other',
      expect.stringContaining('绑定成功'),
    );
  });

  describe('POST /wechat/event 签名校验(2026-09-20新增,修复无鉴权伪造事件问题)', () => {
    const xml =
      '<xml><FromUserName><![CDATA[attacker-openid]]></FromUserName>' +
      '<MsgType><![CDATA[event]]></MsgType><Event><![CDATA[subscribe]]></Event>' +
      '<EventKey><![CDATA[qrscene_123]]></EventKey></xml>';

    it('缺少签名参数时拒绝,不解析事件、不查库', async () => {
      const res = response();

      await controller.event(undefined, undefined, undefined, request(xml), res.value);

      expect(res.value.status).toHaveBeenCalledWith(401);
      expect(res.send).not.toHaveBeenCalledWith('success');
      expect(prisma.contractSigningTask.findFirst).not.toHaveBeenCalled();
      expect(prisma.tenant.findFirst).not.toHaveBeenCalled();
    });

    it('签名错误时拒绝,不解析事件、不查库', async () => {
      const res = response();

      await controller.event('wrong-signature', TIMESTAMP, NONCE, request(xml), res.value);

      expect(res.value.status).toHaveBeenCalledWith(401);
      expect(res.send).not.toHaveBeenCalledWith('success');
      expect(prisma.contractSigningTask.findFirst).not.toHaveBeenCalled();
    });

    it('WECHAT_TOKEN 未配置时拒绝(不允许空token通过校验)', async () => {
      delete process.env.WECHAT_TOKEN;
      const res = response();

      await controller.event(
        sign('', TIMESTAMP, NONCE),
        TIMESTAMP,
        NONCE,
        request(xml),
        res.value,
      );

      expect(res.value.status).toHaveBeenCalledWith(401);
      expect(prisma.contractSigningTask.findFirst).not.toHaveBeenCalled();
    });

    it('签名正确时正常处理并返回 success', async () => {
      (prisma.contractSigningTask.findFirst as jest.Mock).mockResolvedValue({
        id: 9,
        lease: { room: { roomNo: '205', building: { name: 'R栋' } } },
      });
      (prisma.contractSigningTask.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      const res = response();

      await postEvent(xml, res.value);

      expect(res.value.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith('success');
      expect(prisma.contractSigningTask.findFirst).toHaveBeenCalled();
    });
  });

  describe('verifyUrl (微信服务器URL接入验证)', () => {
    it('签名正确时原样回显echostr', () => {
      const res = response();

      controller.verifyUrl(validSignature, TIMESTAMP, NONCE, 'echo-value', res.value);

      expect(res.value.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith('echo-value');
    });

    it('签名不匹配时拒绝', () => {
      const res = response();

      controller.verifyUrl('wrong-signature', '123', 'nonce', 'echo-value', res.value);

      expect(res.value.status).toHaveBeenCalledWith(403);
      expect(res.send).not.toHaveBeenCalledWith('echo-value');
    });

    it('缺少参数时拒绝', () => {
      const res = response();

      controller.verifyUrl(undefined, undefined, undefined, undefined, res.value);

      expect(res.value.status).toHaveBeenCalledWith(400);
    });
  });
});
