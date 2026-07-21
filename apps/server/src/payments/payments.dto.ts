import { IsInt, IsString, IsOptional, IsNumber, IsDateString, Min } from 'class-validator';

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
  @IsString()
  action!: 'confirm' | 'reject';
}
