import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BillsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(leaseId?: number, status?: string) {
    const where: Record<string, unknown> = {};
    if (leaseId) where.leaseId = leaseId;
    if (status) where.status = status;

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
}
