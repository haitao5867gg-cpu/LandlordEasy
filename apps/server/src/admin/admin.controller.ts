import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  ParseIntPipe,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ID_CARD_PATTERN } from '../common/constants/validation-patterns';
import { Type } from 'class-transformer';
import { AdminService } from './admin.service';
import { LandlordGuard } from '../auth/guards/landlord.guard';
import { JwtPayload } from '../auth/auth.service';

class AddLandlordDto {
  @IsString()
  openid!: string;

  @IsString()
  name!: string;
}

class UpdateLandlordDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class UpdateSettingsDto {
  @IsOptional()
  @IsNumber()
  reminderPreDays?: number;

  @IsOptional()
  @IsNumber()
  reminderOverdueInterval?: number;

  @IsOptional()
  @IsString()
  qrcodeImageUrl?: string;
}

class UpdateContractSettingsDto {
  @IsString()
  @IsNotEmpty()
  landlordName!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(ID_CARD_PATTERN)
  landlordIdCard!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^1[3-9]\d{9}$/)
  landlordPhone!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  defaultPenaltyMonths?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  defaultOverdueDays?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultCleaningFee?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  defaultRenewNoticeDays?: number;

  // ===== M22 新合同模板全局配置 =====

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  payeeName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  waterFeeRule?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  electricityFeeRule?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  gasFeeRule?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  otherFeeRule?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChecklistItemDto)
  defaultItemChecklist?: ChecklistItemDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  continuousStayDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  cumulativeStayDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  abandonedPropertyDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  nonRenewalNoticeDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  earlyTerminationNoticeDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  depositRefundWorkDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxOccupantsPerRoom?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  rentOverdueTerminateDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  disguisedSubletDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  electronicNoticeHours?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  waterPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  electricityPrice?: number;
}

class ChecklistItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  item!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;
}

@Controller('admin')
@UseGuards(LandlordGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // === 白名单管理 ===

  @Get('landlords')
  getLandlords() {
    return this.adminService.getLandlords();
  }

  @Post('landlords')
  addLandlord(@Body() dto: AddLandlordDto) {
    return this.adminService.addLandlord(dto.openid, dto.name);
  }

  @Put('landlords/:id')
  updateLandlord(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLandlordDto) {
    return this.adminService.updateLandlord(id, dto);
  }

  @Delete('landlords/:id')
  removeLandlord(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    const user = (req as unknown as Record<string, unknown>)['user'] as JwtPayload;
    return this.adminService.removeLandlord(id, user.sub);
  }

  // === 系统设置(提醒参数等) ===

  @Get('settings')
  getSettings() {
    return this.adminService.getSettings();
  }

  @Put('settings')
  updateSettings(@Body() dto: UpdateSettingsDto) {
    return this.adminService.updateSettings(dto);
  }

  // === 合同签约设置 ===

  @Get('contract-settings')
  getContractSettings() {
    return this.adminService.getContractSettings();
  }

  @Put('contract-settings')
  updateContractSettings(@Body() dto: UpdateContractSettingsDto) {
    return this.adminService.updateContractSettings(dto);
  }

  // === 收款码图片上传 ===

  @Post('qrcode-upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadQrcode(@UploadedFile() file: Express.Multer.File) {
    return this.adminService.uploadQrcode(file);
  }
}
