import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import {
  CreateEachSignTaskParams,
  CreateEachSignTaskResult,
  IWeiQianService,
} from './weiqian.interface';
import { createWeiQianSign } from './weiqian-sign.util';

interface WeiQianResponse<T> {
  code: number;
  msg?: string;
  data?: T;
  timestamp?: number;
}

interface WeiQianUploadData {
  bId?: string;
}

interface WeiQianCreateTaskData {
  bId?: string;
  shortCode?: string;
}

const AUTH_MODE = 'Signature';

@Injectable()
export class RealWeiQianService implements IWeiQianService {
  private readonly logger = new Logger(RealWeiQianService.name);

  async uploadFile(
    fileBuffer: Buffer,
    fileName: string,
  ): Promise<{ bId: string }> {
    this.validateConfiguration();
    const form = new FormData();
    const fileBytes = new Uint8Array(fileBuffer.byteLength);
    fileBytes.set(fileBuffer);
    form.append('file', new Blob([fileBytes.buffer]), fileName);

    const response = await fetch(this.buildUrl('eachSign/upload'), {
      method: 'POST',
      headers: this.buildSignedHeaders(),
      body: form,
    });
    const envelope = await this.parseJsonResponse<WeiQianUploadData>(
      response,
      'eachSign/upload',
    );
    if (!envelope.data?.bId) {
      throw new BadGatewayException('微签 eachSign/upload 响应缺少 data.bId');
    }
    return { bId: envelope.data.bId };
  }

  async createEachSignTask(
    params: CreateEachSignTaskParams,
  ): Promise<CreateEachSignTaskResult> {
    this.validateConfiguration(['WEIQIAN_COMPANY_ID']);
    const data = {
      launchAccount: params.launchAccount,
      // cId 是 BigInteger,不是字符串,微签"平台互签"改版后的联调demo(2026-09
      // 拿到的weiqian-openapi工程)确认了这个类型,之前当字符串传疑似是
      // code=10001系统异常的根因之一
      cId: Number(process.env.WEIQIAN_COMPANY_ID),
      fBIds: params.fBIds,
      fileName: params.fileName,
      // rType/authType 是字符串,不是数字(同一份demo确认)
      rType: '1',
      authType: '2',
      // 签署模式:1=多方签署一份文件,官方demo固定用1,我们单文件单接收方的场景符合
      signType: 1,
      receiverDTOS: [
        {
          account: params.receiverAccount,
          rName: params.receiverName,
          idCard: params.receiverIdCard,
        },
      ],
      // 官方demo(case1_selfCreate)明确不传positionDTOS/launcherSignRule也能
      // 跑通"自己发自己的"这个标准流程,这次先按demo最小可跑通配置测,发起方
      // 自动盖章(launcherSignRule)等基础流程确认没问题后再单独加回来验证
      ...(params.sendSmsToReceiver === undefined
        ? {}
        : { isSendSmsToReceiver: params.sendSmsToReceiver }),
      ...(params.expiresTime === undefined
        ? {}
        : { expiresTime: params.expiresTime }),
      ...(params.finishSignJumpPage === undefined
        ? {}
        : { finishSignJumpPage: params.finishSignJumpPage }),
      ...(params.parm === undefined ? {} : { parm: params.parm }),
    };
    const envelope = await this.postData<WeiQianCreateTaskData>(
      'eachSign/create',
      data,
    );
    if (!envelope.data?.bId || !envelope.data.shortCode) {
      throw new BadGatewayException(
        '微签 eachSign/create 响应缺少 data.bId 或 data.shortCode',
      );
    }
    return {
      bId: envelope.data.bId,
      shortCode: envelope.data.shortCode,
    };
  }

  async downloadSignedFile(bId: string): Promise<Buffer | null> {
    this.validateConfiguration();
    const dataString = JSON.stringify({ bId });

    try {
      const response = await fetch(this.buildUrl('eachSign/download'), {
        method: 'POST',
        headers: {
          ...this.buildSignedHeaders(dataString),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ Data: dataString }).toString(),
      });
      if (!response.ok) return null;

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (
        contentType.includes('application/json') ||
        contentType.startsWith('text/') ||
        contentType.includes('html')
      ) {
        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) return null;

      const contentDisposition =
        response.headers.get('content-disposition') || '';
      const hasFileHeaders =
        contentType.includes('application/pdf') ||
        contentType.includes('application/octet-stream') ||
        /attachment|filename=/i.test(contentDisposition);
      const hasPdfSignature = buffer.subarray(0, 5).toString('ascii') === '%PDF-';
      return hasFileHeaders || hasPdfSignature ? buffer : null;
    } catch (error) {
      this.logger.warn(
        `微签 eachSign/download 暂未返回有效文件: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async postData<T>(
    endpoint: string,
    data: object,
  ): Promise<WeiQianResponse<T>> {
    const dataString = JSON.stringify(data);
    this.logger.debug(
      `微签 ${endpoint} 请求体(脱敏): ${this.redactForLog(dataString)}`,
    );
    const response = await fetch(this.buildUrl(endpoint), {
      method: 'POST',
      headers: {
        ...this.buildSignedHeaders(dataString),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ Data: dataString }).toString(),
    });
    return this.parseJsonResponse<T>(response, endpoint);
  }

  private async parseJsonResponse<T>(
    response: Response,
    endpoint: string,
  ): Promise<WeiQianResponse<T>> {
    const rawText = await response.text();
    this.logger.debug(
      `微签 ${endpoint} 原始响应 (HTTP ${response.status}): ${rawText}`,
    );
    let envelope: WeiQianResponse<T>;
    try {
      envelope = JSON.parse(rawText) as WeiQianResponse<T>;
    } catch {
      throw new BadGatewayException(
        `微签 ${endpoint} 响应格式无效 (HTTP ${response.status})`,
      );
    }

    if (!response.ok || Number(envelope.code) !== 10000) {
      throw new BadGatewayException(
        `微签 ${endpoint} 调用失败: code=${envelope.code ?? response.status}, msg=${
          envelope.msg || '未知错误'
        }`,
      );
    }
    return envelope;
  }

  /** 打日志前把身份证号/手机号脱敏,避免租客隐私信息完整落进日志文件 */
  private redactForLog(dataString: string): string {
    try {
      const parsed = JSON.parse(dataString);
      if (Array.isArray(parsed.receiverDTOS)) {
        parsed.receiverDTOS = parsed.receiverDTOS.map(
          (r: Record<string, unknown>) => ({
            ...r,
            account:
              typeof r.account === 'string'
                ? r.account.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
                : r.account,
            idCard:
              typeof r.idCard === 'string'
                ? r.idCard.replace(/^(.{4}).*(.{2})$/, '$1***********$2')
                : r.idCard,
          }),
        );
      }
      return JSON.stringify(parsed);
    } catch {
      return '(无法解析,原样跳过脱敏)';
    }
  }

  private buildSignedHeaders(dataString?: string): Record<string, string> {
    const appId = process.env.WEIQIAN_APP_ID || '';
    const timestamp = Date.now().toString();
    const commonParameters = {
      AppId: appId,
      AuthMode: AUTH_MODE,
      ...(dataString === undefined ? {} : { Data: dataString }),
      Timestamp: timestamp,
    };
    return {
      AppId: appId,
      Timestamp: timestamp,
      AuthMode: AUTH_MODE,
      Sign: createWeiQianSign(
        commonParameters,
        process.env.WEIQIAN_APP_SECRET || '',
      ),
    };
  }

  private buildUrl(endpoint: string): string {
    return `${(process.env.WEIQIAN_API_BASE_URL || '').replace(/\/+$/, '')}/${endpoint}`;
  }

  private validateConfiguration(additional: string[] = []): void {
    const required = [
      'WEIQIAN_API_BASE_URL',
      'WEIQIAN_APP_ID',
      'WEIQIAN_APP_SECRET',
      ...additional,
    ];
    const missing = required.filter((name) => !process.env[name]);
    if (missing.length) {
      throw new Error(`微签 real 模式配置不完整: ${missing.join(', ')}`);
    }
  }
}
