import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 账单引擎定时任务
 * 每日 02:00: 扫描 ACTIVE 租约,生成即将到来的账期账单
 * 每日 02:30: 逾期账单标记
 */
@Injectable()
export class BillEngineService {
  private readonly logger = new Logger(BillEngineService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 每日 02:00 自动生成账单 */
  @Cron('0 2 * * *')
  async generateBills() {
    this.logger.log('开始自动生成账单...');
    const activeLeases = await this.prisma.lease.findMany({
      where: { status: 'ACTIVE' },
    });

    let generated = 0;
    for (const lease of activeLeases) {
      const count = await this.generateBillsForLease(lease);
      generated += count;
    }
    this.logger.log(`账单生成完成,共生成 ${generated} 张`);
  }

  /** 每日 02:30 标记逾期账单 */
  @Cron('30 2 * * *')
  async markOverdue() {
    this.logger.log('开始标记逾期账单...');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result = await this.prisma.bill.updateMany({
      where: {
        status: 'PENDING',
        dueDate: { lt: today },
      },
      data: { status: 'OVERDUE' },
    });
    this.logger.log(`标记 ${result.count} 张逾期账单`);
  }

  /**
   * 为单个租约生成账单
   * 规则:下一账期开始日 ≤ 今天+7天 且该账期账单不存在则生成
   */
  async generateBillsForLease(lease: {
    id: number;
    startDate: Date;
    endDate: Date;
    rent: unknown;
    payCycle: string;
    feeItems: unknown;
  }): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const lookAhead = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

    let generated = 0;
    let periodStart = new Date(lease.startDate);

    while (periodStart <= lookAhead && periodStart < new Date(lease.endDate)) {
      const periodEnd = this.getNextPeriodEnd(periodStart, lease.payCycle);
      const actualEnd = periodEnd > new Date(lease.endDate) ? new Date(lease.endDate) : periodEnd;

      // 幂等:检查该账期是否已存在
      const existing = await this.prisma.bill.findUnique({
        where: { leaseId_periodStart: { leaseId: lease.id, periodStart } },
      });

      if (!existing && periodStart <= lookAhead) {
        const rent = Number(lease.rent);
        const feeItems = (lease.feeItems as Array<{ name: string; amount: number }>) || [];
        const feeTotal = feeItems.reduce((sum, item) => sum + item.amount, 0);
        const totalAmount = rent + feeTotal;

        const bill = await this.prisma.bill.create({
          data: {
            leaseId: lease.id,
            periodStart,
            periodEnd: actualEnd,
            dueDate: periodStart, // dueDate = 账期开始日
            totalAmount,
          },
        });

        // 创建费用项
        await this.prisma.billItem.create({
          data: { billId: bill.id, type: 'RENT', name: '月租金', amount: rent },
        });
        for (const fee of feeItems) {
          await this.prisma.billItem.create({
            data: { billId: bill.id, type: 'FEE', name: fee.name, amount: fee.amount },
          });
        }

        generated++;
      }

      // 下一个账期
      periodStart = this.getNextPeriodStart(periodStart, lease.payCycle);
    }

    return generated;
  }

  /** 计算下一个账期开始日 */
  private getNextPeriodStart(current: Date, payCycle: string): Date {
    const next = new Date(current);
    switch (payCycle) {
      case 'QUARTERLY':
        next.setMonth(next.getMonth() + 3);
        break;
      case 'YEARLY':
        next.setFullYear(next.getFullYear() + 1);
        break;
      default: // MONTHLY
        next.setMonth(next.getMonth() + 1);
    }
    // 处理月末边界:如 1/31 → 2/28
    return this.clampToMonthEnd(current, next);
  }

  /** 计算账期结束日(下一期开始日前一天) */
  private getNextPeriodEnd(periodStart: Date, payCycle: string): Date {
    const nextStart = this.getNextPeriodStart(periodStart, payCycle);
    const end = new Date(nextStart);
    end.setDate(end.getDate() - 1);
    return end;
  }

  /**
   * 月末边界处理:
   * 如果原始日为 31 号但目标月份没有 31 号,取该月最后一天
   */
  private clampToMonthEnd(original: Date, target: Date): Date {
    const originalDay = original.getDate();
    // 如果 setMonth 导致日期溢出(如 1/31 → 3/3),回退到上月末
    if (target.getDate() !== originalDay) {
      target.setDate(0); // 设为上月最后一天
    }
    return target;
  }
}
