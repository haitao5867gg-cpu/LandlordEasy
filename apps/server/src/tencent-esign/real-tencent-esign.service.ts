import { BadGatewayException, Injectable } from '@nestjs/common';
import {
  CreateSigningFlowParams,
  CreateSigningFlowResult,
  EsignCallbackHeaders,
  EsignCallbackResult,
  EsignFlowStatusResult,
  EsignStandardField,
  ITencentEsignService,
} from './tencent-esign.interface';
import {
  buildTc3Headers,
  parseTencentEsignCallback,
} from './tencent-esign.crypto';

const API_HOST = 'essbasic.tencentcloudapi.com';
const API_VERSION = '2021-05-26';
const SERVICE = 'essbasic';
const MINI_PROGRAM_APP_ID = 'wxa023b292fd19d41d';
const MINI_PROGRAM_ORIGINAL_ID = 'gh_da88f6188665';

const DEFAULT_FIELD_MAPPINGS: Record<EsignStandardField, string> = {
  tenantName: '租客姓名',
  tenantIdCardNumber: '租客身份证号',
  tenantMobile: '租客手机号',
  rent: '租金',
  leaseStartDate: '起租日',
  leaseEndDate: '到期日',
  deposit: '押金',
  initialWaterMeter: '水表底数',
  initialElectricMeter: '电表底数',
  initialGasMeter: '天然气度数',
  facilities: '设施清单',
};

interface TencentApiError {
  Code?: string;
  Message?: string;
}

interface TencentApiEnvelope<T> {
  Response?: T & { Error?: TencentApiError; RequestId?: string };
}

interface CreateFlowsResponse {
  FlowIds?: string[];
  ErrorMessages?: string[];
}

interface H5SignUrlResponse {
  FlowApproverUrlInfos?: Array<{ SignUrl?: string }>;
}

interface MiniProgramSignUrlResponse {
  SignUrlInfos?: Array<{ SignUrl?: string }>;
}

interface FlowDetail {
  FlowId?: string;
  FlowStatus?: string;
  FlowMessage?: string;
  CreateOn?: number;
  DeadLine?: number;
  FlowApproverInfos?: Array<{
    ApproveName?: string;
    ApproveStatus?: string;
    ApproveMessage?: string;
    ApproveTime?: number;
  }>;
}

interface DescribeFlowResponse {
  FlowInfo?: FlowDetail[];
}

interface ResourceUrlsResponse {
  FlowResourceUrlInfos?: Array<{
    FlowId?: string;
    ResourceUrlInfos?: Array<{ Url?: string; Type?: string }>;
  }>;
}

@Injectable()
export class RealTencentEsignService implements ITencentEsignService {
  async createSigningFlow(
    params: CreateSigningFlowParams,
  ): Promise<CreateSigningFlowResult> {
    const config = this.getConfig(params.templateId);
    const agent = this.buildAgent(config);
    const formFields = this.buildFormFields(params);
    const approver = {
      Name: params.tenant.name,
      Mobile: params.tenant.mobile,
      IdCardType: params.tenant.idCardType || 'ID_CARD',
      IdCardNumber: params.tenant.idCardNumber,
      ApproverType: 'PERSON',
      RecipientId: config.tenantRecipientId,
    };

    const created = await this.request<CreateFlowsResponse>(
      'CreateFlowsByTemplates',
      {
        Agent: agent,
        FlowInfos: [
          {
            FlowName: params.flowName || `${params.tenant.name}房屋租赁合同`,
            FlowType: '房屋租赁合同',
            FlowDescription: 'LandlordEasy房屋租赁电子合同',
            TemplateId: config.templateId,
            Deadline:
              params.deadline || Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
            FormFields: formFields,
            FlowApprovers: [approver],
            ...(params.customerData
              ? { CustomerData: params.customerData }
              : {}),
          },
        ],
      },
      config,
    );

    const flowId = created.FlowIds?.[0];
    if (!flowId || created.ErrorMessages?.[0]) {
      throw new BadGatewayException(
        `腾讯电子签创建签署流程失败: ${created.ErrorMessages?.[0] || '未返回 FlowId'}`,
      );
    }

    const createSignEntries = () =>
      Promise.allSettled([
        this.request<H5SignUrlResponse>(
          'ChannelCreateFlowSignUrl',
          { Agent: agent, FlowId: flowId, FlowApproverInfos: [approver] },
          config,
        ),
        this.request<MiniProgramSignUrlResponse>(
          'CreateSignUrls',
          {
            Agent: agent,
            FlowIds: [flowId],
            Endpoint: 'APP',
            GenerateType: 'PERSON',
            Name: params.tenant.name,
            Mobile: params.tenant.mobile,
            IdCardType: params.tenant.idCardType || 'ID_CARD',
            IdCardNumber: params.tenant.idCardNumber,
          },
          config,
        ),
      ] as const);
    const getH5Url = (result: PromiseSettledResult<H5SignUrlResponse>) =>
      result.status === 'fulfilled'
        ? result.value.FlowApproverUrlInfos?.[0]?.SignUrl
        : undefined;
    const getMiniProgramPath = (
      result: PromiseSettledResult<MiniProgramSignUrlResponse>,
    ) =>
      result.status === 'fulfilled'
        ? result.value.SignUrlInfos?.[0]?.SignUrl
        : undefined;

    let [h5Result, miniProgramResult] = await createSignEntries();
    let signUrl = getH5Url(h5Result);
    let miniProgramPath = getMiniProgramPath(miniProgramResult);
    if (!signUrl && !miniProgramPath) {
      // 官方建议复杂动态控件场景等待 DocumentFill 回调，或等待约 3 秒。
      await new Promise<void>((resolve) => setTimeout(resolve, 3000));
      [h5Result, miniProgramResult] = await createSignEntries();
      signUrl = getH5Url(h5Result);
      miniProgramPath = getMiniProgramPath(miniProgramResult);
    }
    if (!signUrl && !miniProgramPath) {
      throw new BadGatewayException(
        `腾讯电子签流程 ${flowId} 已创建，但未能生成签署入口`,
      );
    }

    return {
      flowId,
      ...(signUrl ? { signUrl } : {}),
      ...(miniProgramPath
        ? {
            miniProgramInfo: {
              appId: MINI_PROGRAM_APP_ID,
              originalId: MINI_PROGRAM_ORIGINAL_ID,
              path: miniProgramPath,
            },
          }
        : {}),
    };
  }

  async getFlowStatus(flowId: string): Promise<EsignFlowStatusResult> {
    const config = this.getConfig(undefined, false);
    const agent = this.buildAgent(config);
    const result = await this.request<DescribeFlowResponse>(
      'DescribeFlowDetailInfo',
      { Agent: agent, FlowIds: [flowId] },
      config,
    );
    const flow = result.FlowInfo?.find((item) => item.FlowId === flowId);
    if (!flow?.FlowStatus) {
      throw new BadGatewayException('腾讯电子签查询流程失败: 未返回流程详情');
    }

    let signedPdfUrl: string | undefined;
    if (flow.FlowStatus === 'ALL') {
      try {
        const resources = await this.request<ResourceUrlsResponse>(
          'DescribeResourceUrlsByFlows',
          { Agent: agent, FlowIds: [flowId] },
          config,
        );
        signedPdfUrl = resources.FlowResourceUrlInfos?.[0]?.ResourceUrlInfos?.find(
          (resource) => resource.Type === 'PDF',
        )?.Url;
      } catch {
        // 状态查询不应因尚未合成 PDF 或未开通渠道下载权限而失败。
      }
    }

    return {
      flowId,
      status: flow.FlowStatus,
      ...(flow.FlowMessage ? { message: flow.FlowMessage } : {}),
      ...(flow.CreateOn ? { createdAt: flow.CreateOn } : {}),
      ...(flow.DeadLine ? { deadline: flow.DeadLine } : {}),
      ...(flow.FlowApproverInfos
        ? {
            approvers: flow.FlowApproverInfos.map((approverStatus) => ({
              name: approverStatus.ApproveName,
              status: approverStatus.ApproveStatus,
              message: approverStatus.ApproveMessage,
              signedAt: approverStatus.ApproveTime,
            })),
          }
        : {}),
      ...(signedPdfUrl ? { signedPdfUrl } : {}),
    };
  }

  verifyAndParseCallback(
    body: unknown,
    headers: EsignCallbackHeaders,
  ): EsignCallbackResult {
    return parseTencentEsignCallback(body, headers, {
      verifyToken: process.env.TENCENT_ESIGN_CALLBACK_VERIFY_TOKEN || undefined,
      encryptionKey:
        process.env.TENCENT_ESIGN_CALLBACK_ENCRYPT_KEY || undefined,
    });
  }

  private buildFormFields(params: CreateSigningFlowParams) {
    const mappings = { ...DEFAULT_FIELD_MAPPINGS, ...params.fieldMappings };
    const values: Partial<Record<EsignStandardField, unknown>> = {
      tenantName: params.tenant.name,
      tenantIdCardNumber: params.tenant.idCardNumber,
      tenantMobile: params.tenant.mobile,
      rent: params.contract.rent,
      leaseStartDate: this.formatDate(params.contract.leaseStartDate),
      leaseEndDate: this.formatDate(params.contract.leaseEndDate),
      deposit: params.contract.deposit,
      initialWaterMeter: params.contract.initialWaterMeter,
      initialElectricMeter: params.contract.initialElectricMeter,
      initialGasMeter: params.contract.initialGasMeter,
      facilities: params.contract.facilities?.join('、'),
    };
    const standardFields = Object.entries(values)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => ({
        ComponentName: mappings[key as EsignStandardField],
        ComponentValue: String(value),
      }));
    const additionalFields = Object.entries(
      params.contract.additionalFields || {},
    ).map(([name, value]) => ({
      ComponentName: name,
      ComponentValue: String(value),
    }));
    return [...standardFields, ...additionalFields];
  }

  private formatDate(value: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return match ? `${match[1]}年${match[2]}月${match[3]}日` : value;
  }

  private buildAgent(config: ReturnType<RealTencentEsignService['getConfig']>) {
    return {
      AppId: config.appId,
      ProxyOrganizationOpenId: config.proxyOrganizationOpenId,
      ProxyOperator: { OpenId: config.proxyOperatorOpenId },
    };
  }

  private getConfig(
    templateIdOverride?: string,
    requireTemplateConfig = true,
  ) {
    const config = {
      secretId: process.env.TENCENT_ESIGN_SECRET_ID || '',
      secretKey: process.env.TENCENT_ESIGN_SECRET_KEY || '',
      templateId:
        templateIdOverride || process.env.TENCENT_ESIGN_TEMPLATE_ID || '',
      appId: process.env.TENCENT_ESIGN_APP_ID || '',
      proxyOrganizationOpenId:
        process.env.TENCENT_ESIGN_PROXY_ORGANIZATION_OPEN_ID || '',
      proxyOperatorOpenId:
        process.env.TENCENT_ESIGN_PROXY_OPERATOR_OPEN_ID || '',
      tenantRecipientId:
        process.env.TENCENT_ESIGN_TENANT_RECIPIENT_ID || '',
    };
    const requiredKeys = [
      'secretId',
      'secretKey',
      'appId',
      'proxyOrganizationOpenId',
      'proxyOperatorOpenId',
      ...(requireTemplateConfig ? ['templateId', 'tenantRecipientId'] : []),
    ] as Array<keyof typeof config>;
    const missing = requiredKeys.filter((name) => !config[name]);
    if (missing.length) {
      throw new Error(`腾讯电子签 real 模式配置不完整: ${missing.join(', ')}`);
    }
    return config;
  }

  private async request<T>(
    action: string,
    payload: object,
    config: ReturnType<RealTencentEsignService['getConfig']>,
  ): Promise<T> {
    const body = JSON.stringify(payload);
    const headers = buildTc3Headers({
      secretId: config.secretId,
      secretKey: config.secretKey,
      host: API_HOST,
      service: SERVICE,
      action,
      version: API_VERSION,
      payload: body,
    });
    const response = await fetch(`https://${API_HOST}`, {
      method: 'POST',
      headers,
      body,
    });
    const envelope = (await response.json()) as TencentApiEnvelope<T>;
    const result = envelope.Response;
    if (!response.ok || !result || result.Error) {
      throw new BadGatewayException(
        `腾讯电子签 ${action} 失败: ${result?.Error?.Message || result?.Error?.Code || response.status}`,
      );
    }
    return result;
  }
}
