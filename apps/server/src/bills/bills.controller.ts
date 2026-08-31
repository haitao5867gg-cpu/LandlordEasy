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
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

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

class BatchRemindDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(1, { each: true })
  billIds!: number[];
}

@Controller('bills')
@UseGuards(LandlordGuard)
export class BillsController {
  constructor(
    private readonly billsService: BillsService,
    private readonly billEngine: BillEngineService,
  ) {}

  @Get()
  findAll(
    @Query('leaseId') leaseId?: string,
    @Query('status') status?: string,
    @Query('propertyId') propertyId?: string,
  ) {
    return this.billsService.findAll(
      leaseId ? parseInt(leaseId) : undefined,
      status,
      propertyId ? parseInt(propertyId) : undefined,
    );
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.billsService.findOne(id);
  }

  @Post('batch-remind')
  batchRemind(@Body() dto: BatchRemindDto) {
    return this.billsService.batchRemind(dto.billIds);
  }

  @Post(':id/remind')
  remind(@Param('id', ParseIntPipe) id: number) {
    return this.billsService.remind(id);
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
