import { RawBodyRequest } from '@nestjs/common';
import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LeasesService } from '../leases/leases.service';
import { IWechatCustomerServiceService } from './wechat-customer-service.interface';
import { WechatEventService } from './wechat-event.service';
import { WechatController } from './wechat.controller';

describe('WechatController contract signing events', () => {
  let prisma: jest.Mocked<PrismaService>;
  let customerService: jest.Mocked<IWechatCustomerServiceService>;
  let leasesService: jest.Mocked<LeasesService>;
  let controller: WechatController;

  beforeEach(() => {
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
      tryConfirmSigned: jest.fn(),
    } as unknown as jest.Mocked<LeasesService>;
    controller = new WechatController(
      prisma,
      new WechatEventService(),
      customerService,
      leasesService,
    );
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

  it.each([
    ['subscribe', 'qrscene_123'],
    ['SCAN', '123'],
  ])('%s 事件按场景值将任务转为 FOLLOWED', async (event, eventKey) => {
    const xml =
      `<xml><FromUserName><![CDATA[openid-1]]></FromUserName>` +
      `<MsgType><![CDATA[event]]></MsgType><Event><![CDATA[${event}]]></Event>` +
      `<EventKey><![CDATA[${eventKey}]]></EventKey></xml>`;
    (prisma.contractSigningTask.findFirst as jest.Mock).mockResolvedValue({ id: 9 });
    (prisma.contractSigningTask.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    customerService.sendTextMessage.mockResolvedValue(true);
    const res = response();

    await controller.event(request(xml), res.value);

    expect(prisma.contractSigningTask.findFirst).toHaveBeenCalledWith({
      where: { sceneValue: 123, status: 'PENDING_SCAN' },
      select: { id: true },
    });
    expect(prisma.contractSigningTask.updateMany).toHaveBeenCalledWith({
      where: { id: 9, status: 'PENDING_SCAN' },
      data: { status: 'FOLLOWED', followerOpenid: 'openid-1' },
    });
    expect(customerService.sendTextMessage).toHaveBeenCalledWith(
      'openid-1',
      expect.stringContaining('待签约状态'),
    );
    expect(res.send).toHaveBeenCalledWith('success');
  });

  it('场景值未匹配时发送默认欢迎语', async () => {
    (prisma.contractSigningTask.findFirst as jest.Mock).mockResolvedValue(null);
    customerService.sendTextMessage.mockResolvedValue(true);
    const res = response();

    await controller.event(
      request(
        '<xml><FromUserName>openid-2</FromUserName><MsgType>event</MsgType>' +
          '<Event>subscribe</Event><EventKey>qrscene_456</EventKey></xml>',
      ),
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
      controller.event(
        request(
          '<xml><FromUserName>openid-3</FromUserName><MsgType>event</MsgType>' +
            '<Event>SCAN</Event><EventKey>789</EventKey></xml>',
        ),
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

    await controller.event(
      request(
        '<xml><FromUserName><![CDATA[openid-tenant]]></FromUserName>' +
          '<MsgType><![CDATA[event]]></MsgType><Event><![CDATA[subscribe]]></Event>' +
          '<EventKey><![CDATA[qrscene_321]]></EventKey></xml>',
      ),
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

    await controller.event(
      request(
        '<xml><FromUserName><![CDATA[openid-other]]></FromUserName>' +
          '<MsgType><![CDATA[event]]></MsgType><Event><![CDATA[scan]]></Event>' +
          '<EventKey><![CDATA[321]]></EventKey></xml>',
      ),
      res.value,
    );

    expect(prisma.tenant.update).not.toHaveBeenCalled();
    expect(customerService.sendTextMessage).toHaveBeenCalledWith(
      'openid-other',
      expect.stringContaining('绑定成功'),
    );
  });

  describe('verifyUrl (微信服务器URL接入验证)', () => {
    const originalToken = process.env.WECHAT_TOKEN;

    afterEach(() => {
      if (originalToken === undefined) delete process.env.WECHAT_TOKEN;
      else process.env.WECHAT_TOKEN = originalToken;
    });

    function sign(token: string, timestamp: string, nonce: string): string {
      return createHash('sha1')
        .update([token, timestamp, nonce].sort().join(''))
        .digest('hex');
    }

    it('签名正确时原样回显echostr', () => {
      process.env.WECHAT_TOKEN = 'test-token';
      const timestamp = '1735689600';
      const nonce = 'abc123';
      const signature = sign('test-token', timestamp, nonce);
      const res = response();

      controller.verifyUrl(signature, timestamp, nonce, 'echo-value', res.value);

      expect(res.value.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith('echo-value');
    });

    it('签名不匹配时拒绝', () => {
      process.env.WECHAT_TOKEN = 'test-token';
      const res = response();

      controller.verifyUrl('wrong-signature', '123', 'nonce', 'echo-value', res.value);

      expect(res.value.status).toHaveBeenCalledWith(403);
      expect(res.send).not.toHaveBeenCalledWith('echo-value');
    });

    it('缺少参数时拒绝', () => {
      process.env.WECHAT_TOKEN = 'test-token';
      const res = response();

      controller.verifyUrl(undefined, undefined, undefined, undefined, res.value);

      expect(res.value.status).toHaveBeenCalledWith(400);
    });
  });
});
