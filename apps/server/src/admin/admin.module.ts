import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    AuthModule,
    MulterModule.register({
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    }),
  ],
  controllers: [AdminController],
  providers: [AdminService],
  // M22:LeasesService 注入 AdminService 读提醒参数(合同"提前支付天数"),必须导出
  exports: [AdminService],
})
export class AdminModule {}
