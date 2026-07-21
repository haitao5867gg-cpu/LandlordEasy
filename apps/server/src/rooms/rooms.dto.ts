import { IsString, IsOptional, IsNumber, IsInt, IsArray, Min } from 'class-validator';

export class CreateRoomDto {
  @IsInt()
  buildingId!: number;

  @IsString()
  roomNo!: string;

  @IsInt()
  @Min(1)
  floor!: number;

  @IsOptional()
  @IsInt()
  roomTypeId?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  rentOverride?: number;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class UpdateRoomDto {
  @IsOptional()
  @IsInt()
  roomTypeId?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  rentOverride?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photos?: string[];

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

/**
 * 批量创建房间: 选楼栋+房型, 输入房间号区间
 * 例: buildingId=1, roomTypeId=1, startRoom='301', endRoom='315' → 生成 301~315
 */
export class BatchCreateRoomsDto {
  @IsInt()
  buildingId!: number;

  @IsOptional()
  @IsInt()
  roomTypeId?: number;

  @IsString()
  startRoom!: string; // e.g. '301'

  @IsString()
  endRoom!: string; // e.g. '315'
}
