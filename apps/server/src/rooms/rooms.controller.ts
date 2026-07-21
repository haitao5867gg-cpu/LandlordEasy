import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { LandlordGuard } from '../auth/guards/landlord.guard';
import { CreateRoomDto, UpdateRoomDto, BatchCreateRoomsDto } from './rooms.dto';

@Controller('rooms')
@UseGuards(LandlordGuard)
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Get()
  findAll(
    @Query('buildingId') buildingId?: string,
    @Query('status') status?: string,
  ) {
    return this.roomsService.findAll(
      buildingId ? parseInt(buildingId) : undefined,
      status,
    );
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.roomsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateRoomDto) {
    return this.roomsService.create(dto);
  }

  @Post('batch')
  batchCreate(@Body() dto: BatchCreateRoomsDto) {
    return this.roomsService.batchCreate(dto);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoomDto) {
    return this.roomsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.roomsService.remove(id);
  }
}
