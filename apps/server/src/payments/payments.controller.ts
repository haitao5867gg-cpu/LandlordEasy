import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { PaymentsService, AlipayNotifyBody, WechatNotifyBody } from './payments.service';
import {
  ConfirmPaymentDto,
  CreateOnlinePaymentDto,
  ManualPaymentDto,
  MockSimulateSuccessDto,
} from './payments.dto';
import { LandlordGuard } from '../auth/guards/landlord.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { JwtPayload } from '../auth/auth.service';
import {
  isPaymentSimulationEnabled,
  resolveAlipayEnabled,
} from '../config/startup-config';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * JSAPI调起结果上报(诊断用,公开):前端WeixinJSBridge回调后把微信返回的
   * err_msg/err_desc原样报上来落日志。调起失败的具体原因只存在于这段文字里
   * (2026-09-21两台手机"首次支付-1、清缓存后成功"复现,5秒toast窗口截不到)。
   */
  @Post('wechat/invoke-report')
  invokeReport(@Body() body: Record<string, unknown>) {
    this.logger.log(
      `[JSAPI调起上报] ${JSON.stringify(body).slice(0, 500)}`,
    );
    return { received: true };
  }

  @Post('wechat/create-order')
  @UseGuards(TenantGuard)
  createWechatOrder(@Body() dto: CreateOnlinePaymentDto, @Req() req: Request) {
    const user = (req as unknown as Record<string, unknown>)['user'] as JwtPayload;
    return this.paymentsService.createWechatOrder(
      dto.billId,
      user.tenantId,
      user.openid,
    );
  }

  @Post('alipay/create-order')
  @UseGuards(TenantGuard)
  createAlipayOrder(@Body() dto: CreateOnlinePaymentDto, @Req() req: Request) {
    if (!resolveAlipayEnabled()) {
      throw new BadRequestException('支付宝支付暂未开放，请使用微信支付');
    }
    const user = (req as unknown as Record<string, unknown>)['user'] as JwtPayload;
    return this.paymentsService.createAlipayOrder(
      dto.billId,
      user.tenantId,
      user.openid,
    );
  }

  /** 微信支付服务器公开回调，不使用 JWT Guard。 */
  @Post('wechat/notify')
  wechatNotify(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: WechatNotifyBody,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.paymentsService.handleWechatNotify(body, req.rawBody, headers);
  }

  /** 支付宝服务器公开回调，不使用 JWT Guard。 */
  @Post('alipay/notify')
  alipayNotify(@Body() body: AlipayNotifyBody) {
    return this.paymentsService.handleAlipayNotify(body);
  }

  /** 仅 mock 模式可见；real 模式必须表现为接口不存在。 */
  @Post('mock/simulate-success')
  mockSimulateSuccess(@Body() dto: MockSimulateSuccessDto) {
    if (!isPaymentSimulationEnabled()) {
      throw new NotFoundException();
    }
    return this.paymentsService.simulateSuccess(dto.outTradeNo);
  }

  /** 房东:待确认列表 */
  @Get('pending')
  @UseGuards(LandlordGuard)
  getPending(@Query('propertyId') propertyId?: string) {
    return this.paymentsService.getPending(
      propertyId ? parseInt(propertyId) : undefined,
    );
  }

  /** 房东:确认或驳回 */
  @Post(':id/confirm')
  @UseGuards(LandlordGuard)
  confirm(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ConfirmPaymentDto,
    @Req() req: Request,
  ) {
    const user = (req as unknown as Record<string, unknown>)['user'] as JwtPayload;
    return this.paymentsService.confirmOrReject(id, dto.action, user.sub);
  }

  /** 房东:手动记账 */
  @Post('manual')
  @UseGuards(LandlordGuard)
  manualRecord(@Body() dto: ManualPaymentDto, @Req() req: Request) {
    const user = (req as unknown as Record<string, unknown>)['user'] as JwtPayload;
    return this.paymentsService.manualRecord(dto, user.sub);
  }

  /** 按账单查收款记录 */
  @Get()
  @UseGuards(LandlordGuard)
  findByBill(@Query('billId') billId: string) {
    return this.paymentsService.findByBill(parseInt(billId));
  }
}
