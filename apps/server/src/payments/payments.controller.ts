import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  ParseIntPipe,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { LandlordGuard } from '../auth/guards/landlord.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { TenantReportPaymentDto, ManualPaymentDto, ConfirmPaymentDto } from './payments.dto';
import { JwtPayload } from '../auth/auth.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /** 房东:待确认列表 */
  @Get('pending')
  @UseGuards(LandlordGuard)
  getPending() {
    return this.paymentsService.getPending();
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
