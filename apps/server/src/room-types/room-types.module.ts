import { Module } from '@nestjs/common';
import { RoomTypesController } from './room-types.controller';
import { RoomTypesService } from './room-types.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [RoomTypesController],
  providers: [RoomTypesService],
})
export class RoomTypesModule {}
