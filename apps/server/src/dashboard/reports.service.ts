import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 月度经营报表
   * - 应收/实收/收缴率(支持按楼栋分组)
   * - 月度支出合计(按类目)
   * - 净收益 = 实收 − 支出
   * - 空置率
   */
  async getMonthlyReport(month: string, buildingId?: number) {
    const start = new Date(`${month}-01`);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

    // 1. 应收:该月 dueDate 在范围内的账单 totalAmount 合计
    const billsWhere: Record<string, unknown> = {
      dueDate: { gte: start, lt: end },
    };
    if (buildingId) {
      billsWhere.lease = { room: { buildingId } };
    }

    const bills = await this.prisma.bill.findMany({
      where: billsWhere,
      include: {
        payments: true,
        lease: { include: { room: { include: { building: true } } } },
      },
    });

    const receivable = bills.reduce((sum, b) => sum + Number(b.totalAmount), 0);

    // 2. 实收:该月 CONFIRMED 支付合计
    const confirmedPayments = bills.flatMap((b) =>
      b.payments.filter((p) => p.status === 'CONFIRMED'),
    );
    const received = confirmedPayments.reduce((sum, p) => sum + Number(p.amount), 0);

    // 收缴率
    const collectionRate = receivable > 0 ? Math.round((received / receivable) * 10000) / 100 : 0;

    // 按楼栋分组
    const byBuilding: Record<string, { receivable: number; received: number; rate: number }> = {};
    for (const bill of bills) {
      const bName = bill.lease.room.building.name;
      if (!byBuilding[bName]) byBuilding[bName] = { receivable: 0, received: 0, rate: 0 };
      byBuilding[bName].receivable += Number(bill.totalAmount);
      const billReceived = bill.payments
        .filter((p) => p.status === 'CONFIRMED')
        .reduce((sum, p) => sum + Number(p.amount), 0);
      byBuilding[bName].received += billReceived;
    }
    for (const key of Object.keys(byBuilding)) {
      const b = byBuilding[key];
      b.rate = b.receivable > 0 ? Math.round((b.received / b.receivable) * 10000) / 100 : 0;
    }

    // 3. 月度支出(按类目)
    const expenseWhere: Record<string, unknown> = {
      date: { gte: start, lt: end },
    };
    if (buildingId) expenseWhere.buildingId = buildingId;

    const expenses = await this.prisma.expense.findMany({ where: expenseWhere });
    const totalExpense = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

    const expenseByCategory: Record<string, number> = {};
    for (const e of expenses) {
      expenseByCategory[e.category] = (expenseByCategory[e.category] || 0) + Number(e.amount);
    }

    // 4. 净收益
    const netIncome = received - totalExpense;

    // 5. 空置率
    const roomFilter: Record<string, unknown> = {};
    if (buildingId) roomFilter.buildingId = buildingId;

    const totalRooms = await this.prisma.room.count({ where: roomFilter });
    const vacantRooms = await this.prisma.room.count({
      where: { ...roomFilter, status: 'VACANT' },
    });
    const vacancyRate = totalRooms > 0 ? Math.round((vacantRooms / totalRooms) * 10000) / 100 : 0;

    // 空置损失估算:空置房数 × 平均月租
    const avgRent = receivable > 0 && bills.length > 0 ? receivable / bills.length : 0;
    const vacancyLoss = Math.round(vacantRooms * avgRent);

    return {
      month,
      receivable: Math.round(receivable * 100) / 100,
      received: Math.round(received * 100) / 100,
      collectionRate,
      byBuilding,
      expense: {
        total: Math.round(totalExpense * 100) / 100,
        byCategory: expenseByCategory,
      },
      netIncome: Math.round(netIncome * 100) / 100,
      vacancy: {
        totalRooms,
        vacantRooms,
        vacancyRate,
        estimatedLoss: vacancyLoss,
      },
    };
  }

  /** 押金总额 */
  async getDepositSummary() {
    const records = await this.prisma.depositRecord.findMany();

    let totalReceived = 0;
    let totalRefunded = 0;
    let totalDeducted = 0;

    for (const r of records) {
      const amount = Number(r.amount);
      if (r.type === 'RECEIVE') totalReceived += amount;
      else if (r.type === 'REFUND') totalRefunded += amount;
      else if (r.type === 'DEDUCT') totalDeducted += amount;
    }

    const balance = totalReceived - totalRefunded - totalDeducted;

    return {
      totalReceived: Math.round(totalReceived * 100) / 100,
      totalRefunded: Math.round(totalRefunded * 100) / 100,
      totalDeducted: Math.round(totalDeducted * 100) / 100,
      currentBalance: Math.round(balance * 100) / 100,
    };
  }
}
