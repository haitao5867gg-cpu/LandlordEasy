import { IsInt, IsString, IsIn, IsOptional, IsNumber, IsDateString, Min, IsNotEmpty } from 'class-validator';

/** 在线支付下单 */
export class CreateOnlinePaymentDto {
  @IsInt()
  billId!: number;
}

/** Mock 支付成功模拟 */
export class MockSimulateSuccessDto {
  @IsString()
  @IsNotEmpty()
  outTradeNo!: string;
}

/** 租客上报付款 */
export class TenantReportPaymentDto {
  @IsInt()
  billId!: number;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  proofUrl?: string;

  @IsDateString()
  paidAt!: string;
}

/** 房东手动记账 */
export class ManualPaymentDto {
  @IsInt()
  billId!: number;

  @IsString()
  channel!: string; // CASH / TRANSFER

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsDateString()
  paidAt!: string;
}

/** 确认/驳回 */
export class ConfirmPaymentDto {
  @IsIn(['confirm', 'reject'])
  action!: 'confirm' | 'reject';
}
