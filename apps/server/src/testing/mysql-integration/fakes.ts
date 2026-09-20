import { IWechatQrcodeService } from '../../wechat/wechat-qrcode.interface';
import { IWechatCustomerServiceService } from '../../wechat/wechat-customer-service.interface';
import { IWechatNotifyService } from '../../wechat/wechat-notify.interface';
import { ContractPdfService } from '../../contract-pdf/contract-pdf.service';
import {
  CreateEachSignTaskParams,
  IWeiQianService,
} from '../../weiqian/weiqian.interface';

/**
 * Deterministic fakes for every external collaborator LeasesService talks to
 * after a database transaction commits. They never touch the network. Every
 * response is a pure function of its input so assertions stay reproducible.
 * jest.fn() wrapping lets tests assert call counts (e.g. no duplicate
 * provider launch on retry) without adding any hidden non-determinism.
 */

export function createFakeWechatQrcode(): jest.Mocked<IWechatQrcodeService> {
  return {
    createSceneQrcode: jest.fn(async (sceneValue: number) => ({
      ticket: `fake-ticket-${sceneValue}`,
      qrCodeImage: `data:image/png;base64,fake-${sceneValue}`,
    })),
  };
}

export function createFakeContractPdf(): jest.Mocked<ContractPdfService> {
  return {
    generate: jest.fn(async () => Buffer.from('fake-pdf-content')),
  } as unknown as jest.Mocked<ContractPdfService>;
}

export function createFakeWeiqian(): jest.Mocked<IWeiQianService> {
  return {
    uploadFile: jest.fn(async (_fileBuffer: Buffer, _fileName: string) => ({ bId: 'fake-bid' })),
    createEachSignTask: jest.fn(async (_params: CreateEachSignTaskParams) => ({
      bId: 'fake-bid',
      shortCode: 'fake-code',
    })),
    downloadSignedFile: jest.fn(async (_bId: string) => null),
  };
}

export function createFakeWechatCustomerService(): jest.Mocked<IWechatCustomerServiceService> {
  return {
    sendTextMessage: jest.fn(async (_openid: string, _content: string) => true),
  };
}

export function createFakeWechatNotify(): jest.Mocked<IWechatNotifyService> {
  return {
    sendTemplateMessage: jest.fn(async (_payload) => true),
  };
}
