import { Module } from '@nestjs/common';
import { TenantApiController } from './tenant-api.controller';
import { TenantApiService } from './tenant-api.service';
import { AuthModule } from '../auth/auth.module';
import { LeasesModule } from '../leases/leases.module';
import { MaintenanceModule } from '../maintenance/maintenance.module';

@Module({
  imports: [AuthModule, LeasesModule, MaintenanceModule],
  controllers: [TenantApiController],
  providers: [TenantApiService],
})
export class TenantApiModule {}
