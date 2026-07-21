import { Controller, Get, Post, Body, UseGuards, Req, BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { TenantApiService } from './tenant-api.service';
import { JwtPayload } from '../auth/auth.service';

class BindInviteCodeDto {
  inviteCode!: string;
}

@Controller('tenant')
export class TenantApiController {
  constructor(private readonly tenantApiService: TenantApiService) {}

  @Post('bind')
  @UseGuards(TenantGuard)
  async bindInviteCode(@Body() dto: BindInviteCodeDto, @Req() req: Request) {
    const user = (req as unknown as Record<string, unknown>)['user'] as JwtPayload;
    if (!user.openid) throw new BadRequestException('缺少openid');
    return this.tenantApiService.bindInviteCode(user.openid, dto.inviteCode);
  }

  @Get('bills')
  @UseGuards(TenantGuard)
  async getMyBills(@Req() req: Request) {
    const user = (req as unknown as Record<string, unknown>)['user'] as JwtPayload;
    if (!user.tenantId) throw new BadRequestException('未绑定租约');
    return this.tenantApiService.getMyBills(user.tenantId);
  }

  @Get('leases')
  @UseGuards(TenantGuard)
  async getMyLeases(@Req() req: Request) {
    const user = (req as unknown as Record<string, unknown>)['user'] as JwtPayload;
    if (!user.tenantId) throw new BadRequestException('未绑定租约');
    return this.tenantApiService.getMyLeases(user.tenantId);
  }

  /** 租客获取收款码图片(不敏感,TenantGuard 保护) */
  @Get('qrcode')
  @UseGuards(TenantGuard)
  async getQrcode() {
    return this.tenantApiService.getQrcodeUrl();
  }
}
