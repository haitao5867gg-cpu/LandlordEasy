import { Response } from 'express';

export function sendContractPdf(res: Response, pdf: Buffer, id: number, kind: 'signed' | 'preview'): void {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="contract-${id}-${kind}.pdf"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(pdf);
}
