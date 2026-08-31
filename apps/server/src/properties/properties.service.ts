import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PropertiesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.property.findMany({ orderBy: { sort: 'asc' } });
  }

  async findOne(id: number) {
    const property = await this.prisma.property.findUnique({ where: { id } });
    if (!property) throw new NotFoundException('公寓不存在');
    return property;
  }

  async create(data: { name: string; sort?: number }) {
    return this.prisma.property.create({ data });
  }

  async update(id: number, data: { name?: string; sort?: number }) {
    await this.findOne(id);
    return this.prisma.property.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    const buildingCount = await this.prisma.building.count({ where: { propertyId: id } });
    if (buildingCount > 0) {
      throw new BadRequestException('该公寓下有楼栋,无法删除');
    }
    return this.prisma.property.delete({ where: { id } });
  }
}
