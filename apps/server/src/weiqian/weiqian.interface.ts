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
  /** 接收方指定盖章/签字位置,微签不支持关键字定位,这个字段疑似必填 */
  receiverPosition?: { x: number; y: number; pageNum: number };
  expiresTime?: number;
  sendSmsToReceiver?: boolean;
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
