import { IsString, IsOptional, IsInt } from 'class-validator';

export class CreateAnnouncementDto {
  @IsString()
  title!: string;

  @IsString()
  content!: string;

  /** 不传=发给全部公寓的在租租客 */
  @IsOptional()
  @IsInt()
  propertyId?: number;
}
