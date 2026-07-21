import { Controller, Get, Post, Param, Body, Query, UseGuards, ParseIntPipe, Req } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import { LandlordGuard } from '../auth/guards/landlord.guard';
import { CreateMaintenanceDto } from './maintenance.dto';
import { Request } from 'express';
import { JwtPayload } from '../auth/auth.service';

@Controller('maintenance')
@UseGuards(LandlordGuard)
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @Get()
  findAll(@Query('roomId') roomId?: string) {
    return this.maintenanceService.findAll(roomId ? parseInt(roomId) : undefined);
  }

  @Post()
  create(@Body() dto: CreateMaintenanceDto, @Req() req: Request) {
    const user = (req as unknown as Record<string, unknown>)['user'] as JwtPayload;
    return this.maintenanceService.create(dto, user.sub);
  }
}
