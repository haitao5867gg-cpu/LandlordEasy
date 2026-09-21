import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  IWechatCustomerServiceService,
  WECHAT_CUSTOMER_SERVICE,
} from '../wechat/wechat-customer-service.interface';
import { CreateAnnouncementDto } from './announcements.dto';

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(WECHAT_CUSTOMER_SERVICE)
    private readonly wechatCustomerService: IWechatCustomerServiceService,
  ) {}

  async findAll() {
    return this.prisma.announcement.findMany({
      include: { property: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 群发通知走微信客服消息接口(不是模板消息),对48小时内跟公众号有过互动的租客才能
   * 送达成功——这是当前阶段的已知平台限制,不是bug。发送结果的成功/失败数量如实
   * 记录并返回给房东,不假装100%必达。
   */
  async create(dto: CreateAnnouncementDto, operatorId: number) {
    const tenants = await this.prisma.tenant.findMany({
      where: {
        openid: { not: null },
        leases: {
          some: {
            status: 'ACTIVE',
            ...(dto.propertyId
              ? { room: { building: { propertyId: dto.propertyId } } }
              : {}),
          },
        },
      },
      select: { id: true, openid: true },
      distinct: ['id'],
    });

    const messageText = `【通知】${dto.title}\n${dto.content}`;
    let successCount = 0;
    let failCount = 0;
    for (const tenant of tenants) {
      const ok = await this.wechatCustomerService.sendTextMessage(
        tenant.openid as string,
        messageText,
      );
      if (ok) successCount += 1;
      else failCount += 1;
    }

    return this.prisma.announcement.create({
      data: {
        title: dto.title,
        content: dto.content,
        propertyId: dto.propertyId,
        createdBy: operatorId,
        successCount,
        failCount,
      },
    });
  }
}
