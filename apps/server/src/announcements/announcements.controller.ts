import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { Request } from 'express';
import { AnnouncementsService } from './announcements.service';
import { LandlordGuard } from '../auth/guards/landlord.guard';
import { CreateAnnouncementDto } from './announcements.dto';
import { JwtPayload } from '../auth/auth.service';

@Controller('announcements')
@UseGuards(LandlordGuard)
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Get()
  findAll() {
    return this.announcementsService.findAll();
  }

  @Post()
  create(@Body() dto: CreateAnnouncementDto, @Req() req: Request) {
    const user = (req as unknown as Record<string, unknown>)['user'] as JwtPayload;
    return this.announcementsService.create(dto, user.sub);
  }
}
