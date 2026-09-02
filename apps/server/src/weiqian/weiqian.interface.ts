export const WEIQIAN_SERVICE = 'WEIQIAN_SERVICE';

export interface CreateEachSignTaskParams {
  launchAccount: string;
  /** 文件业务ID列表,微签"平台互签"改版后是纯字符串数组,不是{fBId,fileName}对象 */
  fBIds: string[];
  /** 文件名是eachSign/create请求体的独立顶层字段,不挂在每个fBId上 */
  fileName: string;
  receiverAccount: string;
  receiverName: string;
  receiverIdCard: string;
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
