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
  getMonthlyReport(
    @Query('month') month: string,
    @Query('buildingId') buildingId?: string,
    @Query('propertyId') propertyId?: string,
  ) {
    return this.reportsService.getMonthlyReport(
      month,
      buildingId ? parseInt(buildingId) : undefined,
      propertyId ? parseInt(propertyId) : undefined,
    );
  }

  /** 押金总额 */
  @Get('deposit-summary')
  getDepositSummary(@Query('propertyId') propertyId?: string) {
    return this.reportsService.getDepositSummary(propertyId ? parseInt(propertyId) : undefined);
  }
}
