export const TENCENT_ESIGN_SERVICE = 'TENCENT_ESIGN_SERVICE';

export type EsignFieldValue = string | number | boolean;

export type EsignStandardField =
  | 'tenantName'
  | 'tenantIdCardNumber'
  | 'tenantMobile'
  | 'rent'
  | 'leaseStartDate'
  | 'leaseEndDate'
  | 'deposit'
  | 'initialWaterMeter'
  | 'initialElectricMeter'
  | 'initialGasMeter'
  | 'facilities';

export interface EsignTenantInfo {
  name: string;
  idCardNumber: string;
  mobile: string;
  idCardType?: 'ID_CARD' | 'HONGKONG_AND_MACAO' | 'HONGKONG_MACAO_AND_TAIWAN';
}

export interface EsignContractFields {
  rent: EsignFieldValue;
  leaseStartDate: string;
  leaseEndDate: string;
  deposit: EsignFieldValue;
  initialWaterMeter?: EsignFieldValue;
  initialElectricMeter?: EsignFieldValue;
  initialGasMeter?: EsignFieldValue;
  facilities?: string[];
  additionalFields?: Record<string, EsignFieldValue>;
}

export interface CreateSigningFlowParams {
  /** 默认读取 TENCENT_ESIGN_TEMPLATE_ID；仅用于多模板场景覆盖。 */
  templateId?: string;
  tenant: EsignTenantInfo;
  contract: EsignContractFields;
  /** 必须与腾讯电子签模板中的 ComponentName 一致。 */
  fieldMappings?: Partial<Record<EsignStandardField, string>>;
  flowName?: string;
  deadline?: number;
  /** 腾讯电子签要求此值为 Base64，且长度不超过 1000。 */
  customerData?: string;
}

export interface EsignMiniProgramInfo {
  appId: string;
  originalId: string;
  path: string;
}

export interface CreateSigningFlowResult {
  flowId: string;
  /** ChannelCreateFlowSignUrl 返回的移动端 H5 签署链接。 */
  signUrl?: string;
  /** CreateSignUrls Endpoint=APP 返回的腾讯电子签小程序跳转信息。 */
  miniProgramInfo?: EsignMiniProgramInfo;
}

export interface EsignApproverStatus {
  name?: string;
  status?: string;
  message?: string;
  signedAt?: number;
}

export interface EsignFlowStatusResult {
  flowId: string;
  status: string;
  message?: string;
  createdAt?: number;
  deadline?: number;
  approvers?: EsignApproverStatus[];
  /** 仅 ALL 状态下通过 DescribeResourceUrlsByFlows 另行获取，链接有时效。 */
  signedPdfUrl?: string;
}

export type EsignCallbackHeaders = Record<
  string,
  string | string[] | undefined
>;

export interface EsignCallbackResult {
  flowId: string;
  status: string;
  /** 官方 FlowStatusChange payload 不包含下载链接，通常为 undefined。 */
  signedPdfUrl?: string;
}

export interface ITencentEsignService {
  createSigningFlow(
    params: CreateSigningFlowParams,
  ): Promise<CreateSigningFlowResult>;
  getFlowStatus(flowId: string): Promise<EsignFlowStatusResult>;
  verifyAndParseCallback(
    body: unknown,
    headers: EsignCallbackHeaders,
  ): EsignCallbackResult;
}
