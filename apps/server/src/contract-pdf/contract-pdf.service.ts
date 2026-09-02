import { Injectable } from '@nestjs/common';
import { buildContractHtml } from './contract-pdf.template';
import { ContractPdfData } from './contract-pdf.types';
import { renderContractHtmlToPdf } from './contract-pdf.generator';
import { numberToChineseUppercase } from './number-to-chinese-uppercase';

@Injectable()
export class ContractPdfService {
  async generate(data: ContractPdfData): Promise<Buffer> {
    const rentUppercase = numberToChineseUppercase(data.monthlyRent);
    const html = buildContractHtml(data, rentUppercase);
    return renderContractHtmlToPdf(html);
  }
}
