import { Module } from '@nestjs/common';
import { TenantApiController } from './tenant-api.controller';
import { TenantApiService } from './tenant-api.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [TenantApiController],
  providers: [TenantApiService],
})
export class TenantApiModule {}
