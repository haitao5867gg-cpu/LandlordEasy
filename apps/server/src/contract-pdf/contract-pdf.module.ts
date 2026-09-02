import { Module } from '@nestjs/common';
import { ContractPdfService } from './contract-pdf.service';

@Module({
  providers: [ContractPdfService],
  exports: [ContractPdfService],
})
export class ContractPdfModule {}
