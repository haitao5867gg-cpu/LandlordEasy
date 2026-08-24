import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoomDto, UpdateRoomDto, BatchCreateRoomsDto } from './rooms.dto';

@Injectable()
export class RoomsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 按楼栋分组查询,支持状态筛选 */
  async findAll(buildingId?: number, status?: string) {
    const where: Record<string, unknown> = {};
    if (buildingId) where.buildingId = buildingId;
    if (status) where.status = status;

    return this.prisma.room.findMany({
      where,
      include: { building: true, roomType: true },
      orderBy: [{ buildingId: 'asc' }, { roomNo: 'asc' }],
    });
  }

  /** 房间详情:聚合租约、账单、收款、押金、维修、操作日志 */
  async findOne(id: number) {
    const room = await this.prisma.room.findUnique({
      where: { id },
      include: {
        building: true,
        roomType: true,
        leases: {
          include: {
            tenant: true,
            bills: {
              include: { items: true, payments: true },
              orderBy: { periodStart: 'desc' },
            },
            depositRecords: true,
            handoverRecords: true,
          },
          orderBy: { startDate: 'desc' },
        },
        maintenanceRecords: { orderBy: { date: 'desc' } },
        expenses: { orderBy: { date: 'desc' } },
      },
    });
    if (!room) throw new NotFoundException('房间不存在');

    // 获取该房间的操作日志
    const auditLogs = await this.prisma.auditLog.findMany({
      where: { entityType: 'rooms', entityId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return { ...room, auditLogs };
  }

  async create(dto: CreateRoomDto) {
    return this.prisma.room.create({
      data: {
        buildingId: dto.buildingId,
        roomNo: dto.roomNo,
        floor: dto.floor,
        roomTypeId: dto.roomTypeId,
        rentOverride: dto.rentOverride,
        remark: dto.remark,
      },
    });
  }

  /** 批量创建房间 */
  async batchCreate(dto: BatchCreateRoomsDto) {
    const startNum = parseInt(dto.startRoom);
    const endNum = dto.endRoom ? parseInt(dto.endRoom) : startNum;

    if (isNaN(startNum) || isNaN(endNum) || startNum > endNum) {
      throw new BadRequestException('房间号区间无效');
    }

    const roomNos = [];
    for (let num = startNum; num <= endNum; num++) {
      roomNos.push(num.toString());
    }

    const existingRooms = await this.prisma.room.findMany({
      where: {
        buildingId: dto.buildingId,
        roomNo: { in: roomNos },
      },
      select: { roomNo: true },
    });
    const existingRoomNos = new Set(existingRooms.map((room) => room.roomNo));
    const skipped = roomNos.filter((roomNo) => existingRoomNos.has(roomNo));
    const toCreate = roomNos.filter((roomNo) => !existingRoomNos.has(roomNo));

    if (toCreate.length === 0) {
      throw new BadRequestException(`房号 ${roomNos.join('~')} 均已存在,未创建任何房间`);
    }

    const result = await this.prisma.room.createMany({
      data: toCreate.map((roomNo) => {
        const num = parseInt(roomNo);
        return {
          buildingId: dto.buildingId,
          roomNo,
          floor: Math.floor(num / 100),
          roomTypeId: dto.roomTypeId || null,
          status: 'VACANT',
        };
      }),
      skipDuplicates: true,
    });

    return { created: result.count, total: roomNos.length, skipped };
  }

  async update(id: number, dto: UpdateRoomDto) {
    await this.findOneBasic(id);
    return this.prisma.room.update({
      where: { id },
      data: {
        ...(dto.roomTypeId !== undefined && { roomTypeId: dto.roomTypeId }),
        ...(dto.rentOverride !== undefined && { rentOverride: dto.rentOverride }),
        ...(dto.photos !== undefined && { photos: JSON.parse(JSON.stringify(dto.photos)) }),
        ...(dto.remark !== undefined && { remark: dto.remark }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
  }

  async remove(id: number) {
    await this.findOneBasic(id);
    const leaseCount = await this.prisma.lease.count({ where: { roomId: id } });
    if (leaseCount > 0) {
      throw new BadRequestException('该房间有租约记录,无法删除');
    }
    return this.prisma.room.delete({ where: { id } });
  }

  private async findOneBasic(id: number) {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room) throw new NotFoundException('房间不存在');
    return room;
  }
}
