import { RawBodyRequest } from '@nestjs/common';
import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LeasesService } from '../leases/leases.service';
import { IWechatCustomerServiceService } from './wechat-customer-service.interface';
import { IWechatNotifyService } from './wechat-notify.interface';
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
  let wechatNotify: jest.Mocked<IWechatNotifyService>;
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
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      lease: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    } as unknown as jest.Mocked<PrismaService>;
    process.env.SERVER_PUBLIC_BASE_URL = 'https://dev.landlordeasy.cn/api/v1';
    delete process.env.WECHAT_TEMPLATE_BIND_SUCCESS;
    customerService = {
      sendTextMessage: jest.fn(),
      sendNewsMessage: jest.fn(),
    };
    wechatNotify = { sendTemplateMessage: jest.fn() };
    leasesService = {
      launchContractSigningTask: jest.fn(),
      tryConfirmSigned: jest.fn(),
      confirmSignedByCallbackToken: jest.fn(),
    } as unknown as jest.Mocked<LeasesService>;
    controller = new WechatController(
      prisma,
      new WechatEventService(),
      customerService,
      wechatNotify,
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
    customerService.sendNewsMessage.mockResolvedValue(true);
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
    customerService.sendNewsMessage.mockResolvedValue(true);
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
    expect(prisma.tenant.updateMany).toHaveBeenCalledWith({
      where: { id: 5, openid: null },
      data: { openid: 'openid-tenant' },
    });
    // 主路径:图文卡片(标题+租客端链接),不再发纯文字
    expect(customerService.sendNewsMessage).toHaveBeenCalledWith(
      'openid-tenant',
      expect.objectContaining({
        title: '绑定成功',
        url: expect.stringContaining('https://dev.landlordeasy.cn/tenant/'),
      }),
    );
    expect(customerService.sendTextMessage).not.toHaveBeenCalledWith(
      'openid-tenant',
      expect.stringContaining('绑定成功'),
    );
  });

  it('配置了绑定模板时优先发模板消息(合同时间/合同房源字段对齐真实模板),不再走图文/文字', async () => {
    (prisma.contractSigningTask.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.tenant.findFirst as jest.Mock).mockResolvedValue({ id: 5, openid: null });
    (prisma.lease.findFirst as jest.Mock).mockResolvedValue({
      startDate: new Date('2026-09-21T00:00:00+08:00'),
      endDate: new Date('2027-09-20T00:00:00+08:00'),
      room: { roomNo: '101', building: { name: 'R栋' } },
    });
    process.env.WECHAT_TEMPLATE_BIND_SUCCESS = 'tpl-bind-test';
    wechatNotify.sendTemplateMessage.mockResolvedValue(true);
    const res = response();

    await postEvent(
      '<xml><FromUserName><![CDATA[openid-tenant]]></FromUserName>' +
        '<MsgType><![CDATA[event]]></MsgType><Event><![CDATA[subscribe]]></Event>' +
        '<EventKey><![CDATA[qrscene_321]]></EventKey></xml>',
      res.value,
    );

    expect(wechatNotify.sendTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        openid: 'openid-tenant',
        templateId: 'tpl-bind-test',
        url: 'https://dev.landlordeasy.cn/tenant/',
        data: {
          time3: { value: '2026-09-21至2027-09-20' },
          thing2: { value: 'R栋101' },
        },
      }),
    );
    expect(customerService.sendNewsMessage).not.toHaveBeenCalled();
    expect(customerService.sendTextMessage).not.toHaveBeenCalled();
  });

  it('图文卡片发送失败时回退纯文字,保证绑定提示不丢', async () => {
    (prisma.contractSigningTask.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.tenant.findFirst as jest.Mock).mockResolvedValue({ id: 5, openid: null });
    (prisma.tenant.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    customerService.sendNewsMessage.mockResolvedValueOnce(false);
    customerService.sendTextMessage.mockResolvedValue(true);
    const res = response();

    await postEvent(
      '<xml><FromUserName><![CDATA[openid-tenant]]></FromUserName>' +
        '<MsgType><![CDATA[event]]></MsgType><Event><![CDATA[subscribe]]></Event>' +
        '<EventKey><![CDATA[qrscene_321]]></EventKey></xml>',
      res.value,
    );

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

    expect(prisma.tenant.updateMany).not.toHaveBeenCalled();
    expect(customerService.sendTextMessage).toHaveBeenCalledWith(
      'openid-other',
      expect.stringContaining('已绑定其他微信'),
    );
    expect(customerService.sendTextMessage).not.toHaveBeenCalledWith(
      'openid-other',
      expect.stringContaining('绑定成功'),
    );
  });

  it('租客绑定场景值原子认领竞态失败(count=0)时按已绑定处理,不误报成功', async () => {
    (prisma.contractSigningTask.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.tenant.findFirst as jest.Mock).mockResolvedValue({ id: 5, openid: null });
    (prisma.tenant.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    customerService.sendTextMessage.mockResolvedValue(true);
    const res = response();

    await postEvent(
      '<xml><FromUserName><![CDATA[openid-loser]]></FromUserName>' +
        '<MsgType><![CDATA[event]]></MsgType><Event><![CDATA[scan]]></Event>' +
        '<EventKey><![CDATA[321]]></EventKey></xml>',
      res.value,
    );

    expect(customerService.sendTextMessage).toHaveBeenCalledWith(
      'openid-loser',
      expect.stringContaining('已绑定其他微信'),
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

  describe('contractSignCallback (微签落地页,2026-09-20改为按不可猜测token confirm)', () => {
    it('带上正确token时通过token(不是task id)调用confirmSignedByCallbackToken', async () => {
      leasesService.confirmSignedByCallbackToken.mockResolvedValue(true);
      const res = response();

      await controller.contractSignCallback('real-random-token-value', res.value);

      expect(leasesService.confirmSignedByCallbackToken).toHaveBeenCalledWith(
        'real-random-token-value',
      );
      expect(res.value.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith(
        expect.stringContaining('房东会在系统里核实签署结果后确认'),
      );
    });

    it('缺少parm时不调用confirm,仍正常渲染落地页', async () => {
      const res = response();

      await controller.contractSignCallback(undefined, res.value);

      expect(leasesService.confirmSignedByCallbackToken).not.toHaveBeenCalled();
      expect(res.value.status).toHaveBeenCalledWith(200);
    });

    it('token不匹配/内部异常时不影响落地页正常展示', async () => {
      leasesService.confirmSignedByCallbackToken.mockRejectedValue(new Error('db error'));
      const res = response();

      await expect(
        controller.contractSignCallback('guessed-token', res.value),
      ).resolves.toBeUndefined();

      expect(res.value.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith(
        expect.stringContaining('房东会在系统里核实签署结果后确认'),
      );
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
