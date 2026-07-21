import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { WechatModule } from '../wechat/wechat.module';
import { LandlordGuard } from './guards/landlord.guard';

@Module({
  imports: [WechatModule],
  controllers: [AuthController],
  providers: [AuthService, LandlordGuard],
  exports: [AuthService, LandlordGuard],
})
export class AuthModule {}
