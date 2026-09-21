import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  IWechatNotifyService,
  WECHAT_NOTIFY_SERVICE,
} from '../wechat/wechat-notify.interface';
import { buildRentReminderMessage } from '../reminders/rent-reminder-message';

export interface BatchRemindResult {
  succeeded: number[];
  skipped: Array<{ billId: number; reason: string }>;
}

@Injectable()
export class BillsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(WECHAT_NOTIFY_SERVICE) private readonly wechatNotify: IWechatNotifyService,
  ) {}

  async findAll(leaseId?: number, status?: string, propertyId?: number) {
    const where: Record<string, unknown> = {};
    if (leaseId) where.leaseId = leaseId;
    if (status) where.status = status;
    if (propertyId) where.lease = { room: { building: { propertyId } } };

    return this.prisma.bill.findMany({
      where,
      include: {
        items: true,
        payments: true,
        lease: { include: { room: { include: { building: true } }, tenant: true } },
      },
      orderBy: { dueDate: 'desc' },
    });
  }

  async findOne(id: number) {
    const bill = await this.prisma.bill.findUnique({
      where: { id },
      include: {
        items: true,
        payments: true,
        lease: { include: { room: { include: { building: true } }, tenant: true } },
      },
    });
    if (!bill) throw new NotFoundException('账单不存在');
    return bill;
  }

  /** 手动追加临时费用项 */
  async addBillItem(billId: number, type: string, name: string, amount: number) {
    const bill = await this.prisma.bill.findUnique({ where: { id: billId } });
    if (!bill) throw new NotFoundException('账单不存在');

    const item = await this.prisma.billItem.create({
      data: { billId, type, name, amount },
    });

    // 更新 totalAmount
    await this.prisma.bill.update({
      where: { id: billId },
      data: { totalAmount: { increment: amount } },
    });

    return item;
  }

  /** 追加滞纳金(默认=当期租金) */
  async addLateFee(billId: number, amount?: number) {
    const bill = await this.prisma.bill.findUnique({
      where: { id: billId },
      include: { items: true },
    });
    if (!bill) throw new NotFoundException('账单不存在');
    if (bill.status !== 'OVERDUE') {
      throw new BadRequestException('只能对逾期账单追加滞纳金');
    }

    // 默认金额=租金项金额
    const rentItem = bill.items.find((i) => i.type === 'RENT');
    const lateFeeAmount = amount ?? (rentItem ? Number(rentItem.amount) : 0);

    return this.addBillItem(billId, 'LATE_FEE', '滞纳金', lateFeeAmount);
  }

  async remind(billId: number) {
    await this.sendManualReminder(billId);
    return { billId };
  }

  async batchRemind(billIds: number[]): Promise<BatchRemindResult> {
    const result: BatchRemindResult = { succeeded: [], skipped: [] };

    for (const billId of billIds) {
      try {
        await this.sendManualReminder(billId);
        result.succeeded.push(billId);
      } catch (error) {
        result.skipped.push({ billId, reason: this.getErrorMessage(error) });
      }
    }

    return result;
  }

  /** 单笔和批量催缴共用的校验、发送及日志写入逻辑 */
  private async sendManualReminder(billId: number): Promise<void> {
    const bill = await this.prisma.bill.findUnique({
      where: { id: billId },
      include: {
        lease: {
          include: {
            tenant: true,
            room: { include: { building: { include: { property: true } } } },
          },
        },
      },
    });
    if (!bill) throw new NotFoundException('账单不存在');
    if (!['PENDING', 'OVERDUE'].includes(bill.status)) {
      throw new BadRequestException('该账单无需催缴');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const alreadySent = await this.prisma.reminderLog.findFirst({
      where: {
        billId,
        source: 'MANUAL',
        sentAt: { gte: today, lt: tomorrow },
      },
    });
    if (alreadySent) throw new BadRequestException('今天已经催过了');

    const tenant = bill.lease.tenant;
    if (!tenant.openid) throw new BadRequestException('租客未绑定微信');

    const type = this.getReminderType(bill.dueDate, today);
    // 与reminders.service.ts自动催缴、签约后首期提醒共用同一个构造器——
    // 字段名对应微信公众号后台真实配置的"房租账单催缴通知"模板(2026-09-04用
    // 真实access_token查get_all_private_template核实),且顶层带url直接跳
    // 租客端付款页。之前手动催缴在这里手搓payload漏了url,租客收到消息
    // 不能点击支付(GasCan 2026-09-21实测反馈)。
    const templateId = process.env.WECHAT_TEMPLATE_RENT_REMINDER || 'RENT_REMINDER';
    const success = await this.wechatNotify.sendTemplateMessage(
      buildRentReminderMessage(bill, tenant.openid, templateId),
    );

    await this.prisma.reminderLog.create({
      data: {
        billId,
        tenantId: tenant.id,
        type,
        source: 'MANUAL',
        success,
      },
    });

    if (!success) throw new BadRequestException('提醒发送失败');
  }

  private getReminderType(dueDate: Date, today: Date): 'PRE' | 'DUE' | 'OVERDUE' {
    const dueDay = new Date(dueDate);
    dueDay.setHours(0, 0, 0, 0);
    if (dueDay.getTime() < today.getTime()) return 'OVERDUE';
    if (dueDay.getTime() === today.getTime()) return 'DUE';
    return 'PRE';
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (typeof response === 'string') return response;
      const message = (response as { message?: string | string[] }).message;
      if (Array.isArray(message)) return message.join('；');
      if (message) return message;
    }
    return error instanceof Error ? error.message : '催缴失败';
  }
}
