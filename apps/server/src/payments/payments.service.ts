import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantReportPaymentDto, ManualPaymentDto } from './payments.dto';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 获取待确认的支付记录 */
  async getPending() {
    return this.prisma.payment.findMany({
      where: { status: 'PENDING_CONFIRM' },
      include: {
        bill: {
          include: { lease: { include: { room: { include: { building: true } }, tenant: true } } },
        },
      },
      orderBy: { paidAt: 'desc' },
    });
  }

  /** 确认或驳回 */
  async confirmOrReject(id: number, action: 'confirm' | 'reject', landlordId: number) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: { bill: true },
    });
    if (!payment) throw new NotFoundException('支付记录不存在');
    if (payment.status !== 'PENDING_CONFIRM') {
      throw new BadRequestException('该支付记录已处理');
    }

    if (action === 'confirm') {
      await this.prisma.payment.update({
        where: { id },
        data: {
          status: 'CONFIRMED',
          confirmedBy: landlordId,
          confirmedAt: new Date(),
        },
      });

      // 检查账单是否已付清
      await this.checkBillPaid(payment.billId);
    } else {
      await this.prisma.payment.update({
        where: { id },
        data: { status: 'REJECTED' },
      });
    }

    return this.prisma.payment.findUnique({ where: { id } });
  }

  /** 房东手动记账 */
  async manualRecord(dto: ManualPaymentDto, landlordId: number) {
    const bill = await this.prisma.bill.findUnique({ where: { id: dto.billId } });
    if (!bill) throw new NotFoundException('账单不存在');

    const payment = await this.prisma.payment.create({
      data: {
        billId: dto.billId,
        channel: dto.channel,
        amount: dto.amount,
        status: 'CONFIRMED',
        paidAt: new Date(dto.paidAt),
        confirmedBy: landlordId,
        confirmedAt: new Date(),
      },
    });

    // 检查账单是否已付清
    await this.checkBillPaid(dto.billId);

    return payment;
  }

  /** 租客上报 */
  async tenantReport(dto: TenantReportPaymentDto) {
    const bill = await this.prisma.bill.findUnique({ where: { id: dto.billId } });
    if (!bill) throw new NotFoundException('账单不存在');

    return this.prisma.payment.create({
      data: {
        billId: dto.billId,
        channel: 'QRCODE',
        amount: dto.amount,
        status: 'PENDING_CONFIRM',
        proofUrl: dto.proofUrl,
        paidAt: new Date(dto.paidAt),
      },
    });
  }

  /** 按账单查支付记录 */
  async findByBill(billId: number) {
    return this.prisma.payment.findMany({
      where: { billId },
      orderBy: { paidAt: 'desc' },
    });
  }

  /** 检查账单是否已付清:confirmed 合计 ≥ totalAmount 则标记 PAID */
  private async checkBillPaid(billId: number) {
    const bill = await this.prisma.bill.findUnique({ where: { id: billId } });
    if (!bill) return;

    const payments = await this.prisma.payment.findMany({
      where: { billId, status: 'CONFIRMED' },
    });

    const paidTotal = payments.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );

    if (paidTotal >= Number(bill.totalAmount)) {
      await this.prisma.bill.update({
        where: { id: billId },
        data: { status: 'PAID' },
      });
    }
  }
}
