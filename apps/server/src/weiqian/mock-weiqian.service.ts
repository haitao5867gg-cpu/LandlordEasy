import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  CreateEachSignTaskParams,
  CreateEachSignTaskResult,
  IWeiQianService,
} from './weiqian.interface';

@Injectable()
export class MockWeiQianService implements IWeiQianService {
  async uploadFile(
    _fileBuffer: Buffer,
    _fileName: string,
  ): Promise<{ bId: string }> {
    return { bId: `mock-file-${randomUUID().replaceAll('-', '')}` };
  }

  async createEachSignTask(
    _params: CreateEachSignTaskParams,
  ): Promise<CreateEachSignTaskResult> {
    const id = randomUUID().replaceAll('-', '');
    return {
      bId: `mock-task-${id}`,
      shortCode: `mock-${id.slice(0, 10)}`,
    };
  }

  async downloadSignedFile(bId: string): Promise<Buffer> {
    return Buffer.from(
      `%PDF-1.4\n% LandlordEasy mock signed contract ${bId}\n%%EOF\n`,
      'utf8',
    );
  }
}
