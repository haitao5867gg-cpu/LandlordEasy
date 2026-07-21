import { IsString, IsOptional, IsInt, Min } from 'class-validator';

export class CreateBuildingDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sort?: number;
}

export class UpdateBuildingDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sort?: number;
}
