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
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { ExpensesService } from './expenses.service';
import { LandlordGuard } from '../auth/guards/landlord.guard';
import { CreateExpenseDto, UpdateExpenseDto } from './expenses.dto';
import { JwtPayload } from '../auth/auth.service';

@Controller('expenses')
@UseGuards(LandlordGuard)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Get()
  findAll(@Query('month') month?: string, @Query('category') category?: string) {
    return this.expensesService.findAll(month, category);
  }

  @Post()
  create(@Body() dto: CreateExpenseDto, @Req() req: Request) {
    const user = (req as unknown as Record<string, unknown>)['user'] as JwtPayload;
    return this.expensesService.create(dto, user.sub);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateExpenseDto) {
    return this.expensesService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.expensesService.remove(id);
  }
}
