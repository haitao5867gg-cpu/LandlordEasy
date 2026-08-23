import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateHandoverDto, UpdateHandoverDto } from './handover.dto';

@Injectable()
export class HandoverService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(leaseId?: number) {
    const where = leaseId ? { leaseId } : {};
    return this.prisma.handoverRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(dto: CreateHandoverDto) {
    return this.prisma.handoverRecord.create({
      data: {
        leaseId: dto.leaseId,
        type: dto.type,
        checklist: dto.checklist as Prisma.InputJsonValue | undefined,
        remark: dto.remark,
      },
    });
  }

  async update(id: number, dto: UpdateHandoverDto) {
    await this.ensureExists(id);
    return this.prisma.handoverRecord.update({
      where: { id },
      data: {
        ...(dto.checklist !== undefined
          ? { checklist: dto.checklist as Prisma.InputJsonValue }
          : {}),
        ...(dto.remark !== undefined ? { remark: dto.remark } : {}),
      },
    });
  }

  async remove(id: number) {
    await this.ensureExists(id);
    await this.prisma.handoverRecord.delete({ where: { id } });
  }

  private async ensureExists(id: number) {
    const record = await this.prisma.handoverRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('交接记录不存在');
  }
}
