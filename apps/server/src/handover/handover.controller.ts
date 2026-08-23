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
import { HandoverService } from './handover.service';
import { LandlordGuard } from '../auth/guards/landlord.guard';
import { CreateHandoverDto, UpdateHandoverDto } from './handover.dto';

@Controller('handover')
@UseGuards(LandlordGuard)
export class HandoverController {
  constructor(private readonly handoverService: HandoverService) {}

  @Get()
  findAll(@Query('leaseId') leaseId?: string) {
    return this.handoverService.findAll(leaseId ? parseInt(leaseId) : undefined);
  }

  @Post()
  create(@Body() dto: CreateHandoverDto) {
    return this.handoverService.create(dto);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateHandoverDto) {
    return this.handoverService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.handoverService.remove(id);
  }
}
