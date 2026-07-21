import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { LandlordGuard } from '../auth/guards/landlord.guard';

@Controller('dashboard/reports')
@UseGuards(LandlordGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /**
   * 月度经营报表
   * @param month 格式 '2026-07'
   * @param buildingId 可选,按楼栋筛选
   */
  @Get('monthly')
  getMonthlyReport(@Query('month') month: string, @Query('buildingId') buildingId?: string) {
    return this.reportsService.getMonthlyReport(month, buildingId ? parseInt(buildingId) : undefined);
  }

  /** 押金总额 */
  @Get('deposit-summary')
  getDepositSummary() {
    return this.reportsService.getDepositSummary();
  }
}
