import { Module } from '@nestjs/common';
import { LeasesController } from './leases.controller';
import { LeasesService } from './leases.service';
import { WechatController } from '../wechat/wechat.controller';
import { AuthModule } from '../auth/auth.module';
import { WechatModule } from '../wechat/wechat.module';
import { WeiqianModule } from '../weiqian/weiqian.module';
import { ContractPdfModule } from '../contract-pdf/contract-pdf.module';

@Module({
  imports: [AuthModule, WechatModule, WeiqianModule, ContractPdfModule],
  controllers: [LeasesController, WechatController],
  providers: [LeasesService],
  exports: [LeasesService],
})
export class LeasesModule {}
