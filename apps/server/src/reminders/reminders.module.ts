import { Module } from '@nestjs/common';
import { RemindersService } from './reminders.service';
import { WechatModule } from '../wechat/wechat.module';

@Module({
  imports: [WechatModule],
  providers: [RemindersService],
})
export class RemindersModule {}
