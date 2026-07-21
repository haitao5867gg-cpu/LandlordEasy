import { IsString, IsOptional, IsNumber, IsArray, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';

class FeeItemDto {
  @IsString()
  name!: string;

  @IsNumber()
  @Min(0)
  amount!: number;
}

export class CreateRoomTypeDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  defaultRent!: number;

  @IsNumber()
  @Min(0)
  defaultDeposit!: number;

  @IsOptional()
  @IsString()
  defaultPayCycle?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FeeItemDto)
  defaultFeeItems?: FeeItemDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  furnitureList?: string[];
}

export class UpdateRoomTypeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultRent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultDeposit?: number;

  @IsOptional()
  @IsString()
  defaultPayCycle?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FeeItemDto)
  defaultFeeItems?: FeeItemDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  furnitureList?: string[];
}
