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
import { AdminService } from './admin.service';
import { LandlordGuard } from '../auth/guards/landlord.guard';
import { JwtPayload } from '../auth/auth.service';

class AddLandlordDto {
  openid!: string;
  name!: string;
}

class UpdateLandlordDto {
  name?: string;
  isActive?: boolean;
}

class UpdateSettingsDto {
  reminderPreDays?: number;
  reminderOverdueInterval?: number;
  qrcodeImageUrl?: string;
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

  // === 收款码图片上传 ===

  @Post('qrcode-upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadQrcode(@UploadedFile() file: Express.Multer.File) {
    return this.adminService.uploadQrcode(file);
  }
}
