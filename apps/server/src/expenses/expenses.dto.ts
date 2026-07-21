import { IsString, IsOptional, IsNumber, IsInt, IsDateString, Min } from 'class-validator';

export class CreateExpenseDto {
  @IsDateString()
  date!: string;

  @IsString()
  category!: string;

  @IsString()
  name!: string;

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsInt()
  buildingId?: number;

  @IsOptional()
  @IsInt()
  roomId?: number;
}

export class UpdateExpenseDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsInt()
  buildingId?: number;

  @IsOptional()
  @IsInt()
  roomId?: number;
}
