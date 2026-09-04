import {
  IsString,
  IsOptional,
  IsNumber,
  IsInt,
  IsDateString,
  IsArray,
  IsBoolean,
  IsIn,
  ValidateNested,
  Min,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

class FeeItemDto {
  @IsString()
  name!: string;

  @IsNumber()
  @Min(0)
  amount!: number;
}

export class CreateLeaseDto {
  @IsInt()
  roomId!: number;

  /** 租客信息 */
  @IsString()
  tenantName!: string;

  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  tenantPhone!: string;

  @IsString()
  @Matches(/^\d{17}[\dXx]$|^\d{15}$/, { message: '身份证号格式不正确' })
  tenantIdCard!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsNumber()
  @Min(0)
  rent!: number;

  @IsNumber()
  @Min(0)
  deposit!: number;

  @IsOptional()
  @IsString()
  payCycle?: string; // MONTHLY / QUARTERLY / YEARLY

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FeeItemDto)
  feeItems?: FeeItemDto[];

  @IsOptional()
  @IsString()
  carPlate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  commission?: number;
}

export class EndLeaseDto {
  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsString()
  endReason?: string;

  /** 押金退还金额(0=全扣) */
  @IsNumber()
  @Min(0)
  depositRefund!: number;

  @IsOptional()
  @IsString()
  depositDeductReason?: string;
}

export class RenewLeaseDto {
  @IsDateString()
  newEndDate!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  newRent?: number;
}

class ContractSigningFacilityDto {
  @IsString()
  name!: string;

  @IsBoolean()
  has!: boolean;
}

export class LaunchContractSigningTaskDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  penaltyMonths?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  overdueToleranceDays?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cleaningFee?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  renewalNoticeDays?: number;
}

export class CreateTerminationRequestDto {
  @IsDateString()
  requestedMoveOutDate!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class ApproveTerminationRequestDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  finalPenalty?: number;
}

export class RejectRequestDto {
  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateTransferRequestDto {
  @IsOptional()
  @IsString()
  preferredRoom?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class ApproveTransferRequestDto {
  @IsInt()
  targetRoomId!: number;

  @IsNumber()
  @Min(0)
  newRent!: number;

  @IsNumber()
  @Min(0)
  newDeposit!: number;

  @IsDateString()
  newEndDate!: string;

  @IsOptional()
  @IsDateString()
  newStartDate?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{17}[\dXx]$|^\d{15}$/, { message: '身份证号格式不正确' })
  tenantIdCard?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  oldDepositRefund?: number;

  @IsOptional()
  @IsString()
  oldDepositDeductReason?: string;
}

export class CreateContractSigningTaskDto {
  @IsIn(['NEW', 'RENEW'])
  type!: 'NEW' | 'RENEW';

  @IsOptional()
  @IsNumber()
  waterMeterReading?: number;

  @IsOptional()
  @IsNumber()
  electricityMeterReading?: number;

  @IsOptional()
  @IsNumber()
  gasMeterReading?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContractSigningFacilityDto)
  facilities?: ContractSigningFacilityDto[];

  @IsOptional()
  @IsString()
  extraTerms?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  penaltyMonths?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  overdueToleranceDays?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cleaningFee?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  renewalNoticeDays?: number;
}
