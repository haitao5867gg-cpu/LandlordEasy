import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseDto, UpdateExpenseDto } from './expenses.dto';

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(month?: string, category?: string) {
    const where: Record<string, unknown> = {};
    if (month) {
      // month = '2026-07'
      const start = new Date(`${month}-01`);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      where.date = { gte: start, lt: end };
    }
    if (category) where.category = category;

    return this.prisma.expense.findMany({
      where,
      include: { building: true, room: true },
      orderBy: { date: 'desc' },
    });
  }

  async create(dto: CreateExpenseDto, operatorId: number) {
    return this.prisma.expense.create({
      data: {
        date: new Date(dto.date),
        category: dto.category,
        name: dto.name,
        amount: dto.amount,
        remark: dto.remark,
        buildingId: dto.buildingId,
        roomId: dto.roomId,
        operatorId,
      },
    });
  }

  async update(id: number, dto: UpdateExpenseDto) {
    const expense = await this.prisma.expense.findUnique({ where: { id } });
    if (!expense) throw new NotFoundException('支出记录不存在');

    return this.prisma.expense.update({
      where: { id },
      data: {
        ...(dto.date !== undefined && { date: new Date(dto.date) }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.remark !== undefined && { remark: dto.remark }),
        ...(dto.buildingId !== undefined && { buildingId: dto.buildingId }),
        ...(dto.roomId !== undefined && { roomId: dto.roomId }),
      },
    });
  }

  async remove(id: number) {
    const expense = await this.prisma.expense.findUnique({ where: { id } });
    if (!expense) throw new NotFoundException('支出记录不存在');
    return this.prisma.expense.delete({ where: { id } });
  }
}
