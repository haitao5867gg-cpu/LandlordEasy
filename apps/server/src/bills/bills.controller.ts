import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { BillsService } from './bills.service';
import { BillEngineService } from './bill-engine.service';
import { LandlordGuard } from '../auth/guards/landlord.guard';
import { IsString, IsNumber, IsOptional, Min } from 'class-validator';

class AddBillItemDto {
  @IsString()
  type!: string;

  @IsString()
  name!: string;

  @IsNumber()
  @Min(0)
  amount!: number;
}

class AddLateFeeDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;
}

@Controller('bills')
@UseGuards(LandlordGuard)
export class BillsController {
  constructor(
    private readonly billsService: BillsService,
    private readonly billEngine: BillEngineService,
  ) {}

  @Get()
  findAll(@Query('leaseId') leaseId?: string, @Query('status') status?: string) {
    return this.billsService.findAll(
      leaseId ? parseInt(leaseId) : undefined,
      status,
    );
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.billsService.findOne(id);
  }

  @Post(':id/items')
  addItem(@Param('id', ParseIntPipe) id: number, @Body() dto: AddBillItemDto) {
    return this.billsService.addBillItem(id, dto.type, dto.name, dto.amount);
  }

  @Post(':id/late-fee')
  addLateFee(@Param('id', ParseIntPipe) id: number, @Body() dto: AddLateFeeDto) {
    return this.billsService.addLateFee(id, dto.amount);
  }

  /** 手动触发账单生成(调试用) */
  @Post('generate')
  triggerGenerate() {
    return this.billEngine.generateBills();
  }
}
