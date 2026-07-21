import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  ParseIntPipe,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { LeasesService } from './leases.service';
import { LandlordGuard } from '../auth/guards/landlord.guard';
import { CreateLeaseDto, EndLeaseDto, RenewLeaseDto } from './leases.dto';
import { JwtPayload } from '../auth/auth.service';

@Controller('leases')
@UseGuards(LandlordGuard)
export class LeasesController {
  constructor(private readonly leasesService: LeasesService) {}

  @Get()
  findAll(@Query('roomId') roomId?: string, @Query('status') status?: string) {
    return this.leasesService.findAll(
      roomId ? parseInt(roomId) : undefined,
      status,
    );
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.leasesService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateLeaseDto, @Req() req: Request) {
    const user = (req as unknown as Record<string, unknown>)['user'] as JwtPayload;
    return this.leasesService.create(dto, user.sub);
  }

  @Post(':id/end')
  endLease(@Param('id', ParseIntPipe) id: number, @Body() dto: EndLeaseDto, @Req() req: Request) {
    const user = (req as unknown as Record<string, unknown>)['user'] as JwtPayload;
    return this.leasesService.endLease(id, dto, user.sub);
  }

  @Post(':id/renew')
  renew(@Param('id', ParseIntPipe) id: number, @Body() dto: RenewLeaseDto) {
    return this.leasesService.renew(id, dto);
  }
}
