import { IsInt, IsString, IsNumber, IsDateString, Min } from 'class-validator';

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
