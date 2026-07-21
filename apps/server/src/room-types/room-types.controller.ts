import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, ParseIntPipe } from '@nestjs/common';
import { RoomTypesService } from './room-types.service';
import { LandlordGuard } from '../auth/guards/landlord.guard';
import { CreateRoomTypeDto, UpdateRoomTypeDto } from './room-types.dto';

@Controller('room-types')
@UseGuards(LandlordGuard)
export class RoomTypesController {
  constructor(private readonly roomTypesService: RoomTypesService) {}

  @Get()
  findAll() {
    return this.roomTypesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.roomTypesService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateRoomTypeDto) {
    return this.roomTypesService.create(dto);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoomTypeDto) {
    return this.roomTypesService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.roomTypesService.remove(id);
  }
}
