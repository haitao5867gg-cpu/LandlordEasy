import { RawBodyRequest } from '@nestjs/common';
import { Request, Response } from 'express';
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
    } as unknown as jest.Mocked<PrismaService>;
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
});
