import { Controller, Get, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { LandlordGuard } from '../auth/guards/landlord.guard';

@Controller('dashboard')
@UseGuards(LandlordGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('vacancy')
  getVacancyBoard() {
    return this.dashboardService.getVacancyBoard();
  }

  @Get('expiring')
  getExpiringLeases() {
    return this.dashboardService.getExpiringLeases();
  }

  @Get('overdue')
  getOverdueBoard() {
    return this.dashboardService.getOverdueBoard();
  }
}
