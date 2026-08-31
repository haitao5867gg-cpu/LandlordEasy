import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  CreateSigningFlowParams,
  CreateSigningFlowResult,
  EsignCallbackHeaders,
  EsignCallbackResult,
  EsignFlowStatusResult,
  ITencentEsignService,
} from './tencent-esign.interface';
import { parseTencentEsignCallback } from './tencent-esign.crypto';

@Injectable()
export class MockTencentEsignService implements ITencentEsignService {
  private readonly statuses = new Map<string, string>();

  async createSigningFlow(
    _params: CreateSigningFlowParams,
  ): Promise<CreateSigningFlowResult> {
    const flowId = randomUUID().replaceAll('-', '');
    this.statuses.set(flowId, 'INIT');
    return {
      flowId,
      signUrl: `https://mock.esign.local/sign/${flowId}`,
      miniProgramInfo: {
        appId: 'mock-tencent-esign-appid',
        originalId: 'mock-tencent-esign-original-id',
        path: `/mock/sign/${flowId}`,
      },
    };
  }

  async getFlowStatus(flowId: string): Promise<EsignFlowStatusResult> {
    return {
      flowId,
      status: this.statuses.get(flowId) || 'UNKNOWN',
      ...(this.statuses.get(flowId) === 'ALL'
        ? { signedPdfUrl: `https://mock.esign.local/contracts/${flowId}.pdf` }
        : {}),
    };
  }

  verifyAndParseCallback(
    body: unknown,
    headers: EsignCallbackHeaders,
  ): EsignCallbackResult {
    const result = parseTencentEsignCallback(body, headers);
    this.statuses.set(result.flowId, result.status);
    return result;
  }
}
