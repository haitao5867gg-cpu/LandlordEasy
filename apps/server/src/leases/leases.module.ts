import { Module } from '@nestjs/common';
import { LeasesController } from './leases.controller';
import { LeasesService } from './leases.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [LeasesController],
  providers: [LeasesService],
  exports: [LeasesService],
})
export class LeasesModule {}
