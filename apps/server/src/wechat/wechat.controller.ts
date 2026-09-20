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
import { createHash } from 'crypto';
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

function buildFollowedFallbackMessage(roomLabel: string): string {
  return `【${roomLabel}】您已成功关注,该房源的租房合同已进入待签约状态,房东确认后将自动发起电子签约,请留意后续消息`;
}
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

  /**
   * 微信"服务器配置"URL接入验证握手。首次保存配置、以及微信偶尔重新校验时都会
   * 发这个GET请求过来，必须用Token+timestamp+nonce算出正确签名并原样回显echostr，
   * 否则微信会认为URL不可用，拒绝启用消息推送（进而所有事件POST都收不到）。
   */
  @Get('event')
  verifyUrl(
    @Query('signature') signature: string | undefined,
    @Query('timestamp') timestamp: string | undefined,
    @Query('nonce') nonce: string | undefined,
    @Query('echostr') echostr: string | undefined,
    @Res() response: Response,
  ): void {
    if (!signature || !timestamp || !nonce || !echostr) {
      response.status(400).type('text/plain').send('missing params');
      return;
    }
    if (!this.verifySignature(signature, timestamp, nonce)) {
      this.logger.warn('微信服务器URL接入验证签名不匹配');
      response.status(403).type('text/plain').send('invalid signature');
      return;
    }
    response.status(200).type('text/plain').send(echostr);
  }

  /**
   * 微信每一次事件推送(不只是首次URL接入验证)都会带上同一套signature/timestamp/
   * nonce查询参数,算法与GET接入验证完全一致(sha1(sort([token,timestamp,nonce])
   * 拼接))。这里必须原样校验,否则任何知道这个URL的人都能伪造关注/扫码事件,
   * 把任意签约任务的followerOpenid绑定成攻击者的openid、抢占租客账号绑定场景值
   * (2026-09-20 review发现,已用真实dev环境复现:未校验时可无鉴权伪造subscribe
   * 事件成功绑定)。
   */
  private verifySignature(
    signature: string,
    timestamp: string,
    nonce: string,
  ): boolean {
    const token = process.env.WECHAT_TOKEN || '';
    if (!token) return false;
    const expected = createHash('sha1')
      .update([token, timestamp, nonce].sort().join(''))
      .digest('hex');
    return expected === signature;
  }

  /** 微信服务器公开事件 webhook，不使用房东 Guard，但必须校验微信签名。 */
  @Post('event')
  async event(
    @Query('signature') signature: string | undefined,
    @Query('timestamp') timestamp: string | undefined,
    @Query('nonce') nonce: string | undefined,
    @Req() req: RawBodyRequest<Request>,
    @Res() response: Response,
  ): Promise<void> {
    if (!signature || !timestamp || !nonce || !this.verifySignature(signature, timestamp, nonce)) {
      this.logger.warn('微信事件推送签名校验失败,拒绝处理');
      response.status(401).type('text/plain').send('invalid signature');
      return;
    }

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
          select: {
            id: true,
            lease: { select: { room: { select: { roomNo: true, building: { select: { name: true } } } } } },
          },
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
            try {
              await this.leasesService.launchContractSigningTask(task.id, {});
            } catch (error) {
              this.logger.warn(
                `签约任务 ${task.id} 关注后自动发起失败,请按当前任务状态恢复: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
              const roomLabel = `${task.lease.room.building.name}${task.lease.room.roomNo}`;
              await this.wechatCustomerService.sendTextMessage(
                parsed.openid,
                buildFollowedFallbackMessage(roomLabel),
              );
            }
          }
        }
      }

      if (
        !matched &&
        isFollowEvent &&
        parsed.sceneValue !== undefined &&
        parsed.openid
      ) {
        matched = await this.tryBindTenant(parsed.sceneValue, parsed.openid);
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

  /** 扫描"租客账号绑定"场景二维码,匹配成功即绑定 openid 并推送 tenant-h5 入口链接。 */
  private async tryBindTenant(
    sceneValue: number,
    openid: string,
  ): Promise<boolean> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { bindSceneValue: sceneValue },
      select: { id: true, openid: true },
    });
    if (!tenant) return false;

    // 原子认领:只有当前仍未绑定才写入,避免"先查后写"下两个 openid 并发扫码时
    // 后写覆盖前写(findFirst 读到的 openid:null 可能已经过期)。已绑定本人视为
    // 重复关注,直接当作成功处理。
    let bound = tenant.openid === openid;
    if (!bound && !tenant.openid) {
      const claimed = await this.prisma.tenant.updateMany({
        where: { id: tenant.id, openid: null },
        data: { openid },
      });
      bound = claimed.count === 1;
    }

    if (!bound) {
      this.logger.warn(
        `租客 ${tenant.id} 的绑定场景值被另一个 openid 扫描,已绑定 openid 未被覆盖`,
      );
      // 没有真的绑上,不能告诉扫描者"绑定成功"——那等于确认这个场景值有效,
      // 是在给探测者提供信号。
      await this.wechatCustomerService.sendTextMessage(
        openid,
        '该账号已绑定其他微信,如需变更请联系房东',
      );
      return true;
    }

    const publicBaseUrl = process.env.SERVER_PUBLIC_BASE_URL?.replace(
      /\/+$/,
      '',
    ).replace(/\/api\/v1$/, '');
    const tenantUrl = publicBaseUrl ? `${publicBaseUrl}/tenant/` : '';
    await this.wechatCustomerService.sendTextMessage(
      openid,
      tenantUrl
        ? `绑定成功,点击查看您的租约和账单：${tenantUrl}`
        : '绑定成功,请联系房东获取查看租约和账单的入口',
    );
    return true;
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
