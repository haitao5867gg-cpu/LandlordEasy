import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, ParseIntPipe } from '@nestjs/common';
import { BuildingsService } from './buildings.service';
import { LandlordGuard } from '../auth/guards/landlord.guard';
import { CreateBuildingDto, UpdateBuildingDto } from './buildings.dto';

@Controller('buildings')
@UseGuards(LandlordGuard)
export class BuildingsController {
  constructor(private readonly buildingsService: BuildingsService) {}

  @Get()
  findAll() {
    return this.buildingsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.buildingsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateBuildingDto) {
    return this.buildingsService.create(dto);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBuildingDto) {
    return this.buildingsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.buildingsService.remove(id);
  }
}
