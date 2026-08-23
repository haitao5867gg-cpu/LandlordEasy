import { IsInt, IsIn, IsOptional, IsString, IsArray } from 'class-validator';

export class CreateHandoverDto {
  @IsInt()
  leaseId!: number;

  @IsIn(['CHECKIN', 'CHECKOUT'])
  type!: string;

  @IsOptional()
  @IsArray()
  checklist?: Array<{ item: string; condition: string }>;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class UpdateHandoverDto {
  @IsOptional()
  @IsArray()
  checklist?: Array<{ item: string; condition: string }>;

  @IsOptional()
  @IsString()
  remark?: string;
}
