import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { LandlordGuard } from '../auth/guards/landlord.guard';

@Controller('dashboard')
@UseGuards(LandlordGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('vacancy')
  getVacancyBoard(@Query('propertyId') propertyId?: string) {
    return this.dashboardService.getVacancyBoard(propertyId ? parseInt(propertyId) : undefined);
  }

  @Get('expiring')
  getExpiringLeases(@Query('propertyId') propertyId?: string) {
    return this.dashboardService.getExpiringLeases(propertyId ? parseInt(propertyId) : undefined);
  }

  @Get('overdue')
  getOverdueBoard(@Query('propertyId') propertyId?: string) {
    return this.dashboardService.getOverdueBoard(propertyId ? parseInt(propertyId) : undefined);
  }
}
