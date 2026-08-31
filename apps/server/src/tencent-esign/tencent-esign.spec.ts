import {
  createCipheriv,
  createHmac,
} from 'crypto';
import { MockTencentEsignService } from './mock-tencent-esign.service';
import { RealTencentEsignService } from './real-tencent-esign.service';
import {
  buildTc3Headers,
  parseTencentEsignCallback,
} from './tencent-esign.crypto';
import { CreateSigningFlowParams } from './tencent-esign.interface';

const signingParams: CreateSigningFlowParams = {
  tenant: {
    name: '张三',
    idCardNumber: '110101199001011234',
    mobile: '13800138000',
  },
  contract: {
    rent: 3000,
    leaseStartDate: '2026-09-01',
    leaseEndDate: '2027-08-31',
    deposit: 3000,
    initialWaterMeter: 12.5,
    initialElectricMeter: 30,
    initialGasMeter: 2,
    facilities: ['空调', '冰箱'],
  },
};

const jsonResponse = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(body),
  }) as unknown as Response;

describe('MockTencentEsignService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('不访问外网即可创建、查询并通过回调推进流程', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const service = new MockTencentEsignService();
    const created = await service.createSigningFlow(signingParams);

    expect(created.flowId).toMatch(/^[0-9a-f]{32}$/);
    expect(created.signUrl).toBe(
      `https://mock.esign.local/sign/${created.flowId}`,
    );
    await expect(service.getFlowStatus(created.flowId)).resolves.toMatchObject({
      status: 'INIT',
    });

    expect(
      service.verifyAndParseCallback(
        {
          MsgId: 'mock-message',
          MsgType: 'FlowStatusChange',
          MsgVersion: 'ThirdPartyApp',
          MsgData: { FlowId: created.flowId, FlowStatus: 'ALL' },
        },
        {},
      ),
    ).toEqual({ flowId: created.flowId, status: 'ALL' });
    await expect(service.getFlowStatus(created.flowId)).resolves.toEqual({
      flowId: created.flowId,
      status: 'ALL',
      signedPdfUrl: `https://mock.esign.local/contracts/${created.flowId}.pdf`,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('Tencent e-sign crypto', () => {
  it('生成稳定的腾讯云 API 3.0 请求头', () => {
    const headers = buildTc3Headers({
      secretId: 'AKIDEXAMPLE',
      secretKey: 'SECRETKEYEXAMPLE',
      host: 'essbasic.tencentcloudapi.com',
      service: 'essbasic',
      action: 'DescribeFlowDetailInfo',
      version: '2021-05-26',
      payload: '{"FlowIds":["flow-1"]}',
      timestamp: 1700000000,
    });

    expect(headers).toEqual({
      Authorization:
        'TC3-HMAC-SHA256 Credential=AKIDEXAMPLE/2023-11-14/essbasic/tc3_request, ' +
        'SignedHeaders=content-type;host, ' +
        'Signature=dd39d20acc5786cdbb7f56ecb681b3ec599a51f8cf8457e75c799b744036baad',
      'Content-Type': 'application/json; charset=utf-8',
      Host: 'essbasic.tencentcloudapi.com',
      'X-TC-Action': 'DescribeFlowDetailInfo',
      'X-TC-Version': '2021-05-26',
      'X-TC-Timestamp': '1700000000',
    });
  });

  it('对原始回调体执行 HMAC-SHA256 验签', () => {
    const rawBody = JSON.stringify({
      MsgId: 'message-1',
      MsgType: 'FlowStatusChange',
      MsgVersion: 'ThirdPartyApp',
      MsgData: { FlowId: 'flow-1', FlowStatus: 'ALL' },
    });
    const token = 'callback-token';
    const signature = `sha256=${createHmac('sha256', token)
      .update(rawBody)
      .digest('hex')}`;

    expect(
      parseTencentEsignCallback(
        rawBody,
        { 'content-signature': signature },
        { verifyToken: token },
      ),
    ).toEqual({ flowId: 'flow-1', status: 'ALL' });
    expect(() =>
      parseTencentEsignCallback(
        rawBody,
        { 'Content-Signature': 'sha256=invalid' },
        { verifyToken: token },
      ),
    ).toThrow('腾讯电子签回调签名校验失败');
  });

  it('验签后按 AES-256-CBC 解密回调', () => {
    const encryptionKey = '12345678901234567890123456789012';
    const plaintext = JSON.stringify({
      MsgId: 'message-2',
      MsgType: 'FlowStatusChange',
      MsgVersion: 'ThirdPartyApp',
      MsgData: { FlowId: 'flow-2', FlowStatus: 'PART' },
    });
    const key = Buffer.from(encryptionKey);
    const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]).toString('base64');
    const rawBody = JSON.stringify({ encrypt: encrypted });
    const token = 'verify-token';
    const signature = `sha256=${createHmac('sha256', token)
      .update(rawBody)
      .digest('hex')}`;

    expect(
      parseTencentEsignCallback(
        rawBody,
        { 'Content-Signature': signature },
        { verifyToken: token, encryptionKey },
      ),
    ).toEqual({ flowId: 'flow-2', status: 'PART' });
  });
});

describe('RealTencentEsignService request mapping', () => {
  const envKeys = [
    'TENCENT_ESIGN_SECRET_ID',
    'TENCENT_ESIGN_SECRET_KEY',
    'TENCENT_ESIGN_TEMPLATE_ID',
    'TENCENT_ESIGN_APP_ID',
    'TENCENT_ESIGN_PROXY_ORGANIZATION_OPEN_ID',
    'TENCENT_ESIGN_PROXY_OPERATOR_OPEN_ID',
    'TENCENT_ESIGN_TENANT_RECIPIENT_ID',
  ] as const;
  const originalEnv = Object.fromEntries(
    envKeys.map((key) => [key, process.env[key]]),
  );

  beforeEach(() => {
    process.env.TENCENT_ESIGN_SECRET_ID = 'secret-id';
    process.env.TENCENT_ESIGN_SECRET_KEY = 'secret-key';
    process.env.TENCENT_ESIGN_TEMPLATE_ID = 'template-id';
    process.env.TENCENT_ESIGN_APP_ID = 'application-id';
    process.env.TENCENT_ESIGN_PROXY_ORGANIZATION_OPEN_ID = 'landlord-org';
    process.env.TENCENT_ESIGN_PROXY_OPERATOR_OPEN_ID = 'landlord-operator';
    process.env.TENCENT_ESIGN_TENANT_RECIPIENT_ID = 'tenant-recipient';
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(() => {
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('按模板发起并分别生成 H5 与小程序入口', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          Response: { FlowIds: ['flow-id'], ErrorMessages: [''] },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          Response: { FlowApproverUrlInfos: [{ SignUrl: 'https://h5-sign' }] },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          Response: { SignUrlInfos: [{ SignUrl: 'pages/guide?token=1' }] },
        }),
      );

    await expect(
      new RealTencentEsignService().createSigningFlow(signingParams),
    ).resolves.toEqual({
      flowId: 'flow-id',
      signUrl: 'https://h5-sign',
      miniProgramInfo: {
        appId: 'wxa023b292fd19d41d',
        originalId: 'gh_da88f6188665',
        path: 'pages/guide?token=1',
      },
    });

    const createRequest = fetchSpy.mock.calls[0][1] as RequestInit;
    const createBody = JSON.parse(createRequest.body as string);
    expect(createRequest.headers).toMatchObject({
      'X-TC-Action': 'CreateFlowsByTemplates',
      'X-TC-Version': '2021-05-26',
    });
    expect(createBody.FlowInfos[0]).toMatchObject({
      TemplateId: 'template-id',
      FlowApprovers: [
        {
          Name: '张三',
          Mobile: '13800138000',
          IdCardType: 'ID_CARD',
          IdCardNumber: '110101199001011234',
          ApproverType: 'PERSON',
          RecipientId: 'tenant-recipient',
        },
      ],
    });
    expect(createBody.FlowInfos[0].FormFields).toEqual(
      expect.arrayContaining([
        { ComponentName: '租金', ComponentValue: '3000' },
        { ComponentName: '起租日', ComponentValue: '2026年09月01日' },
        { ComponentName: '设施清单', ComponentValue: '空调、冰箱' },
      ]),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('查询 ALL 状态后获取有时效的签后 PDF 地址', async () => {
    delete process.env.TENCENT_ESIGN_TEMPLATE_ID;
    delete process.env.TENCENT_ESIGN_TENANT_RECIPIENT_ID;
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          Response: {
            FlowInfo: [
              {
                FlowId: 'flow-id',
                FlowStatus: 'ALL',
                FlowMessage: '',
                CreateOn: 1700000000,
                DeadLine: 1701000000,
                FlowApproverInfos: [
                  {
                    ApproveName: '张三',
                    ApproveStatus: 'SIGN',
                    ApproveMessage: '',
                    ApproveTime: 1700000100,
                  },
                ],
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          Response: {
            FlowResourceUrlInfos: [
              {
                FlowId: 'flow-id',
                ResourceUrlInfos: [
                  { Url: 'https://file.example/signed.pdf', Type: 'PDF' },
                ],
              },
            ],
          },
        }),
      );

    await expect(
      new RealTencentEsignService().getFlowStatus('flow-id'),
    ).resolves.toEqual({
      flowId: 'flow-id',
      status: 'ALL',
      createdAt: 1700000000,
      deadline: 1701000000,
      approvers: [
        {
          name: '张三',
          status: 'SIGN',
          message: '',
          signedAt: 1700000100,
        },
      ],
      signedPdfUrl: 'https://file.example/signed.pdf',
    });
    expect(
      (fetchSpy.mock.calls[0][1]?.headers as Record<string, string>)[
        'X-TC-Action'
      ],
    ).toBe('DescribeFlowDetailInfo');
    expect(
      (fetchSpy.mock.calls[1][1]?.headers as Record<string, string>)[
        'X-TC-Action'
      ],
    ).toBe('DescribeResourceUrlsByFlows');
  });
});
