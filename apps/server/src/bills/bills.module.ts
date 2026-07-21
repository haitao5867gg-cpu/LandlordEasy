import { Module } from '@nestjs/common';
import { BillsController } from './bills.controller';
import { BillsService } from './bills.service';
import { BillEngineService } from './bill-engine.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [BillsController],
  providers: [BillsService, BillEngineService],
  exports: [BillsService, BillEngineService],
})
export class BillsModule {}
