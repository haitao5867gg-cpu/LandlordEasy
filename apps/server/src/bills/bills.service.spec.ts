import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BillsService } from './bills.service';
import { PrismaService } from '../prisma/prisma.service';
import { IWechatNotifyService } from '../wechat/wechat-notify.interface';

describe('BillsService manual reminders', () => {
  let service: BillsService;
  let prisma: jest.Mocked<PrismaService>;
  let wechatNotify: jest.Mocked<IWechatNotifyService>;

  const makeBill = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    status: 'PENDING',
    totalAmount: 1200,
    dueDate: new Date('2026-08-31T00:00:00.000Z'),
    lease: { tenant: { id: 10, openid: 'openid-10' } },
    ...overrides,
  });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-31T11:00:00+08:00'));
    prisma = {
      bill: { findUnique: jest.fn() },
      reminderLog: { findFirst: jest.fn(), create: jest.fn() },
    } as unknown as jest.Mocked<PrismaService>;
    wechatNotify = {
      sendTemplateMessage: jest.fn().mockResolvedValue(true),
    };
    service = new BillsService(prisma, wechatNotify);
    (prisma.reminderLog.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.reminderLog.create as jest.Mock).mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('发送模板消息并记录 MANUAL 来源', async () => {
    (prisma.bill.findUnique as jest.Mock).mockResolvedValue(makeBill());

    await expect(service.remind(1)).resolves.toEqual({ billId: 1 });
    expect(wechatNotify.sendTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        openid: 'openid-10',
        data: expect.objectContaining({ keyword3: { value: '今日到期' } }),
      }),
    );
    expect(prisma.reminderLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        billId: 1,
        tenantId: 10,
        type: 'DUE',
        source: 'MANUAL',
        success: true,
      }),
    });
  });

  it('拒绝无需催缴的账单', async () => {
    (prisma.bill.findUnique as jest.Mock).mockResolvedValue(makeBill({ status: 'PAID' }));

    await expect(service.remind(1)).rejects.toThrow(
      new BadRequestException('该账单无需催缴'),
    );
    expect(wechatNotify.sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('拒绝今天已经手动催过的账单', async () => {
    (prisma.bill.findUnique as jest.Mock).mockResolvedValue(makeBill());
    (prisma.reminderLog.findFirst as jest.Mock).mockResolvedValue({ id: 99 });

    await expect(service.remind(1)).rejects.toThrow(
      new BadRequestException('今天已经催过了'),
    );
  });

  it('租客未绑定微信时跳过发送', async () => {
    (prisma.bill.findUnique as jest.Mock).mockResolvedValue(
      makeBill({ lease: { tenant: { id: 10, openid: null } } }),
    );

    await expect(service.remind(1)).rejects.toThrow(
      new BadRequestException('租客未绑定微信'),
    );
    expect(wechatNotify.sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('批量催缴逐笔收集成功和跳过结果', async () => {
    (prisma.bill.findUnique as jest.Mock).mockImplementation(({ where }) =>
      Promise.resolve(where.id === 1 ? makeBill() : null),
    );

    await expect(service.batchRemind([1, 2])).resolves.toEqual({
      succeeded: [1],
      skipped: [{ billId: 2, reason: '账单不存在' }],
    });
    expect(wechatNotify.sendTemplateMessage).toHaveBeenCalledTimes(1);
    expect(prisma.reminderLog.create).toHaveBeenCalledTimes(1);
  });

  it('单笔不存在时返回 404', async () => {
    (prisma.bill.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.remind(999)).rejects.toThrow(
      new NotFoundException('账单不存在'),
    );
  });
});
