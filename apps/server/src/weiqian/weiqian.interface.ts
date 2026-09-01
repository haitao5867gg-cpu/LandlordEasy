export const WEIQIAN_SERVICE = 'WEIQIAN_SERVICE';

export interface WeiQianFileBusinessId {
  fBId: string;
  fileName: string;
}

export interface CreateEachSignTaskParams {
  launchAccount: string;
  fBIds: WeiQianFileBusinessId[];
  receiverAccount: string;
  receiverName: string;
  receiverIdCard: string;
  expiresTime?: number;
  finishSignJumpPage?: string;
  parm?: string;
}

export interface CreateEachSignTaskResult {
  bId: string;
  shortCode: string;
}

export interface IWeiQianService {
  uploadFile(
    fileBuffer: Buffer,
    fileName: string,
  ): Promise<{ bId: string }>;
  createEachSignTask(
    params: CreateEachSignTaskParams,
  ): Promise<CreateEachSignTaskResult>;
  downloadSignedFile(bId: string): Promise<Buffer | null>;
}
