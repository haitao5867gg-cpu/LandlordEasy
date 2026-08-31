import {
  Body,
  Controller,
  Get,
  Headers,
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
  TenantReportPaymentDto,
} from './payments.dto';
import { LandlordGuard } from '../auth/guards/landlord.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { JwtPayload } from '../auth/auth.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

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
    if ((process.env.PAYMENT_MODE || 'mock') !== 'mock') throw new NotFoundException();
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

  /** 租客:上报已付款 */
  @Post('report')
  @UseGuards(TenantGuard)
  tenantReport(@Body() dto: TenantReportPaymentDto) {
    return this.paymentsService.tenantReport(dto);
  }

  /** 按账单查收款记录 */
  @Get()
  @UseGuards(LandlordGuard)
  findByBill(@Query('billId') billId: string) {
    return this.paymentsService.findByBill(parseInt(billId));
  }
}
