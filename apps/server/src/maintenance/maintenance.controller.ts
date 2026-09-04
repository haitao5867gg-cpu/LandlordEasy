import { Controller, Get, Post, Param, Body, Query, UseGuards, ParseIntPipe, Req } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import { LandlordGuard } from '../auth/guards/landlord.guard';
import { CreateMaintenanceDto, UpdateRepairRequestDto } from './maintenance.dto';
import { Request } from 'express';
import { JwtPayload } from '../auth/auth.service';

@Controller('maintenance')
@UseGuards(LandlordGuard)
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @Get()
  findAll(
    @Query('roomId') roomId?: string,
    @Query('propertyId') propertyId?: string,
  ) {
    return this.maintenanceService.findAll(
      roomId ? parseInt(roomId) : undefined,
      propertyId ? parseInt(propertyId) : undefined,
    );
  }

  @Post()
  create(@Body() dto: CreateMaintenanceDto, @Req() req: Request) {
    const user = (req as unknown as Record<string, unknown>)['user'] as JwtPayload;
    return this.maintenanceService.create(dto, user.sub);
  }

  @Get('repair-requests')
  listRepairRequests(
    @Query('status') status?: string,
    @Query('propertyId') propertyId?: string,
  ) {
    return this.maintenanceService.listRepairRequests(
      status,
      propertyId ? parseInt(propertyId) : undefined,
    );
  }

  @Post('repair-requests/:id/status')
  updateRepairRequest(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRepairRequestDto,
    @Req() req: Request,
  ) {
    const user = (req as unknown as Record<string, unknown>)['user'] as JwtPayload;
    return this.maintenanceService.updateRepairRequest(id, dto, user.sub);
  }
}
