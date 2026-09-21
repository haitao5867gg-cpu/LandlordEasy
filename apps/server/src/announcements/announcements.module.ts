import { Module } from '@nestjs/common';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';
import { AuthModule } from '../auth/auth.module';
import { WechatModule } from '../wechat/wechat.module';

@Module({
  imports: [AuthModule, WechatModule],
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService],
})
export class AnnouncementsModule {}
