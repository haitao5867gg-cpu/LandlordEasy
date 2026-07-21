import {
  IsString,
  IsOptional,
  IsNumber,
  IsInt,
  IsDateString,
  IsArray,
  ValidateNested,
  Min,
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
  tenantPhone!: string;

  @IsOptional()
  @IsString()
  tenantIdCard?: string;

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
