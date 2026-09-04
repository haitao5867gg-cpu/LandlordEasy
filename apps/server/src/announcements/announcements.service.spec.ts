import { AnnouncementsService } from './announcements.service';
import { PrismaService } from '../prisma/prisma.service';
import { IWechatCustomerServiceService } from '../wechat/wechat-customer-service.interface';

describe('AnnouncementsService', () => {
  let service: AnnouncementsService;
  let prisma: jest.Mocked<PrismaService>;
  let wechatCustomer: jest.Mocked<IWechatCustomerServiceService>;

  beforeEach(() => {
    prisma = {
      tenant: { findMany: jest.fn() },
      announcement: { create: jest.fn() },
    } as unknown as jest.Mocked<PrismaService>;
    wechatCustomer = { sendTextMessage: jest.fn() };
    service = new AnnouncementsService(prisma, wechatCustomer);
  });

  it('只发给绑定了openid的在租租客,如实统计成功/失败数量', async () => {
    (prisma.tenant.findMany as jest.Mock).mockResolvedValue([
      { id: 1, openid: 'openid-1' },
      { id: 2, openid: 'openid-2' },
      { id: 3, openid: 'openid-3' },
    ]);
    wechatCustomer.sendTextMessage
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    (prisma.announcement.create as jest.Mock).mockImplementation(({ data }) => data);

    const result = await service.create(
      { title: '台风预警', content: '明天有台风,注意出行安全' },
      1,
    );

    expect(prisma.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          openid: { not: null },
          leases: { some: { status: 'ACTIVE' } },
        }),
      }),
    );
    expect(wechatCustomer.sendTextMessage).toHaveBeenCalledTimes(3);
    expect(wechatCustomer.sendTextMessage).toHaveBeenCalledWith(
      'openid-1',
      expect.stringContaining('【通知】台风预警'),
    );
    expect(result.successCount).toBe(2);
    expect(result.failCount).toBe(1);
  });

  it('传propertyId时按公寓过滤在租租客', async () => {
    (prisma.tenant.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.announcement.create as jest.Mock).mockImplementation(({ data }) => data);

    await service.create({ title: '停车费调整', content: '下月起停车费上调', propertyId: 2 }, 1);

    expect(prisma.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          leases: {
            some: {
              status: 'ACTIVE',
              room: { building: { propertyId: 2 } },
            },
          },
        }),
      }),
    );
  });

  it('没有匹配租客时成功/失败数量都是0,不报错', async () => {
    (prisma.tenant.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.announcement.create as jest.Mock).mockImplementation(({ data }) => data);

    const result = await service.create({ title: '通知', content: '内容' }, 1);

    expect(wechatCustomer.sendTextMessage).not.toHaveBeenCalled();
    expect(result.successCount).toBe(0);
    expect(result.failCount).toBe(0);
  });
});
