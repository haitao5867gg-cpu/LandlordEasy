import {
  Controller,
  Get,
  Inject,
  Logger,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import {
  IWechatEventService,
  WECHAT_EVENT_SERVICE,
} from './wechat-event.interface';
import {
  IWechatCustomerServiceService,
  WECHAT_CUSTOMER_SERVICE,
} from './wechat-customer-service.interface';
import { LeasesService } from '../leases/leases.service';

const FOLLOWED_MESSAGE =
  '您的租房合同已进入待签约状态,房东确认后会尽快发起电子签约,请留意后续消息';
const WELCOME_MESSAGE = '欢迎关注,如有问题请联系房东';

@Controller('wechat')
export class WechatController {
  private readonly logger = new Logger(WechatController.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WECHAT_EVENT_SERVICE)
    private readonly wechatEventService: IWechatEventService,
    @Inject(WECHAT_CUSTOMER_SERVICE)
    private readonly wechatCustomerService: IWechatCustomerServiceService,
    private readonly leasesService: LeasesService,
  ) {}

  /** 微信服务器公开事件 webhook，不使用房东 Guard。 */
  @Post('event')
  async event(
    @Req() req: RawBodyRequest<Request>,
    @Res() response: Response,
  ): Promise<void> {
    // 先写出响应，避免数据库或客服消息调用拖过微信要求的 5 秒时限。
    response.status(200).type('text/plain').send('success');

    try {
      const parsed = this.wechatEventService.parseEvent(
        req.rawBody?.toString('utf8') ?? '',
      );
      const isFollowEvent =
        parsed.eventType === 'subscribe' || parsed.eventType === 'scan';
      let matched = false;

      if (
        isFollowEvent &&
        parsed.sceneValue !== undefined &&
        parsed.openid
      ) {
        const task = await this.prisma.contractSigningTask.findFirst({
          where: {
            sceneValue: parsed.sceneValue,
            status: 'PENDING_SCAN',
          },
          select: { id: true },
        });
        if (task) {
          const updated = await this.prisma.contractSigningTask.updateMany({
            where: { id: task.id, status: 'PENDING_SCAN' },
            data: {
              status: 'FOLLOWED',
              followerOpenid: parsed.openid,
            },
          });
          if (updated.count > 0) {
            matched = true;
            await this.wechatCustomerService.sendTextMessage(
              parsed.openid,
              FOLLOWED_MESSAGE,
            );
          }
        }
      }

      if (!matched && isFollowEvent && parsed.openid) {
        await this.wechatCustomerService.sendTextMessage(
          parsed.openid,
          WELCOME_MESSAGE,
        );
      }
    } catch (error) {
      this.logger.error(
        `处理微信事件失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** 微签完成签署后的公开浏览器落地页，不使用房东 Guard。 */
  @Get('contract-sign-callback')
  async contractSignCallback(
    @Query('parm') parm: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    let message = '签约已完成,可以关闭此页面';

    try {
      const taskId = Number(parm);
      if (Number.isSafeInteger(taskId) && taskId > 0) {
        const task = await this.prisma.contractSigningTask.findUnique({
          where: { id: taskId },
          select: { status: true },
        });
        if (task?.status === 'CREATED') {
          const confirmed = await this.leasesService.tryConfirmSigned(taskId);
          message = confirmed
            ? '签约成功,可以关闭此页面'
            : '签约正在处理中,请稍后查看';
        }
      }
    } catch (error) {
      this.logger.error(
        `处理签署落地页失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      message = '签约正在处理中,请稍后查看';
    }

    response.status(200).type('html').send(this.renderResultPage(message));
  }

  private renderResultPage(message: string): string {
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>电子签约</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;text-align:center;padding:72px 24px;color:#333}p{font-size:18px;line-height:1.6}</style></head><body><p>${message}</p></body></html>`;
  }
}
