import { IsInt, IsString, IsNumber, IsOptional, IsIn, IsDateString, Min } from 'class-validator';

export class CreateMaintenanceDto {
  @IsInt()
  roomId!: number;

  @IsDateString()
  date!: string;

  @IsString()
  content!: string;

  @IsNumber()
  @Min(0)
  cost!: number;
}

export class CreateRepairRequestDto {
  @IsString()
  description!: string;
}

export class UpdateRepairRequestDto {
  @IsIn(['IN_PROGRESS', 'RESOLVED'])
  status!: 'IN_PROGRESS' | 'RESOLVED';

  @IsOptional()
  @IsString()
  landlordNote?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  resolvedCost?: number;
}
