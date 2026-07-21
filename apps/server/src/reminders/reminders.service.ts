import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WECHAT_NOTIFY_SERVICE, IWechatNotifyService } from '../wechat/wechat-notify.interface';

/**
 * 催租提醒定时任务
 * 规则:到期前3天提醒一次 → 到期日提醒一次 → 逾期后每3天提醒一次
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WECHAT_NOTIFY_SERVICE) private readonly wechatNotify: IWechatNotifyService,
  ) {}

  /** 每日 09:00 执行催租提醒 */
  @Cron('0 9 * * *')
  async sendReminders() {
    this.logger.log('开始发送催租提醒...');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 待付+逾期账单
    const bills = await this.prisma.bill.findMany({
      where: { status: { in: ['PENDING', 'OVERDUE'] } },
      include: { lease: { include: { tenant: true } } },
    });

    let sentCount = 0;
    for (const bill of bills) {
      const tenant = bill.lease.tenant;
      if (!tenant.openid) continue; // 未绑定的租客无法推送

      const shouldSend = this.shouldSendReminder(bill.dueDate, today);
      if (!shouldSend.send) continue;

      // 检查今天是否已发过
      const alreadySent = await this.prisma.reminderLog.findFirst({
        where: {
          billId: bill.id,
          sentAt: { gte: today },
        },
      });
      if (alreadySent) continue;

      // 发送提醒
      const success = await this.wechatNotify.sendTemplateMessage({
        openid: tenant.openid,
        templateId: 'RENT_REMINDER',
        data: {
          keyword1: { value: `${bill.totalAmount}元` },
          keyword2: { value: bill.dueDate.toISOString().split('T')[0] },
          keyword3: { value: shouldSend.type === 'OVERDUE' ? '已逾期' : '即将到期' },
        },
      });

      await this.prisma.reminderLog.create({
        data: {
          billId: bill.id,
          tenantId: tenant.id,
          type: shouldSend.type,
          success,
        },
      });

      sentCount++;
    }

    this.logger.log(`催租提醒完成,发送 ${sentCount} 条`);
  }

  private shouldSendReminder(
    dueDate: Date,
    today: Date,
  ): { send: boolean; type: string } {
    const diffMs = new Date(dueDate).getTime() - today.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    // 到期前 3 天
    if (diffDays === 3) return { send: true, type: 'PRE' };
    // 到期日
    if (diffDays === 0) return { send: true, type: 'DUE' };
    // 逾期后每 3 天
    if (diffDays < 0 && Math.abs(diffDays) % 3 === 0) return { send: true, type: 'OVERDUE' };

    return { send: false, type: '' };
  }
}
