import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  ParseIntPipe,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { TenantApiService } from './tenant-api.service';
import { JwtPayload } from '../auth/auth.service';
import { CreateRepairRequestDto } from '../maintenance/maintenance.dto';
import {
  CreateTerminationRequestDto,
  CreateTransferRequestDto,
} from '../leases/leases.dto';

@Controller('tenant')
export class TenantApiController {
  constructor(private readonly tenantApiService: TenantApiService) {}

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

  private getTenantId(req: Request): number {
    const user = (req as unknown as Record<string, unknown>)['user'] as JwtPayload;
    if (!user.tenantId) throw new BadRequestException('未绑定租约');
    return user.tenantId;
  }

  @Post('leases/:id/repair-requests')
  @UseGuards(TenantGuard)
  createRepairRequest(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateRepairRequestDto,
    @Req() req: Request,
  ) {
    return this.tenantApiService.createRepairRequest(id, this.getTenantId(req), dto);
  }

  @Get('repair-requests')
  @UseGuards(TenantGuard)
  listMyRepairRequests(@Req() req: Request) {
    return this.tenantApiService.listMyRepairRequests(this.getTenantId(req));
  }

  @Get('leases/:id/termination-penalty-preview')
  @UseGuards(TenantGuard)
  previewTerminationPenalty(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.tenantApiService.previewTerminationPenalty(id, this.getTenantId(req));
  }

  @Post('leases/:id/termination-requests')
  @UseGuards(TenantGuard)
  createTerminationRequest(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateTerminationRequestDto,
    @Req() req: Request,
  ) {
    return this.tenantApiService.createTerminationRequest(id, this.getTenantId(req), dto);
  }

  @Get('termination-requests')
  @UseGuards(TenantGuard)
  listMyTerminationRequests(@Req() req: Request) {
    return this.tenantApiService.listMyTerminationRequests(this.getTenantId(req));
  }

  @Post('leases/:id/transfer-requests')
  @UseGuards(TenantGuard)
  createTransferRequest(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateTransferRequestDto,
    @Req() req: Request,
  ) {
    return this.tenantApiService.createTransferRequest(id, this.getTenantId(req), dto);
  }

  @Get('transfer-requests')
  @UseGuards(TenantGuard)
  listMyTransferRequests(@Req() req: Request) {
    return this.tenantApiService.listMyTransferRequests(this.getTenantId(req));
  }
}
