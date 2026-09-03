import { MockWeiQianService } from './mock-weiqian.service';
import { RealWeiQianService } from './real-weiqian.service';
import { createWeiQianSign } from './weiqian-sign.util';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const commonEnvironment = {
  WEIQIAN_API_BASE_URL: 'https://weiqian.example/openapi/v1/',
  WEIQIAN_APP_ID: 'test-app-id',
  WEIQIAN_APP_SECRET: 'test-app-secret',
  WEIQIAN_COMPANY_ID: '1030391',
  WEIQIAN_SEAL_ID: '37179',
};

describe('createWeiQianSign', () => {
  it('按 ASCII 参数名排序并生成固定的 HMAC-SHA256 Base64 签名', () => {
    const parameters = {
      Timestamp: '1700000000000',
      Data: '{"bId":"task-1"}',
      AuthMode: 'Signature',
      AppId: 'sample-app',
    };

    expect(createWeiQianSign(parameters, 'sample-secret')).toBe(
      'ldgFklz0wfo7R9fslQ5qjZQK+UHSJEyCwVh/WxQmcMk=',
    );
    expect(
      createWeiQianSign(
        { ...parameters, Sign: 'excluded', file: Buffer.from('excluded') },
        'sample-secret',
      ),
    ).toBe('ldgFklz0wfo7R9fslQ5qjZQK+UHSJEyCwVh/WxQmcMk=');
  });

  it('输入或密钥变化时签名随之变化', () => {
    const first = createWeiQianSign({ AppId: 'app-1' }, 'secret');
    expect(createWeiQianSign({ AppId: 'app-2' }, 'secret')).not.toBe(first);
    expect(createWeiQianSign({ AppId: 'app-1' }, 'other-secret')).not.toBe(
      first,
    );
  });
});

describe('MockWeiQianService', () => {
  const service = new MockWeiQianService();

  it('三个方法均返回可供调用方使用的 Mock 数据', async () => {
    const upload = await service.uploadFile(Buffer.from('pdf'), 'lease.pdf');
    expect(upload.bId).toMatch(/^mock-file-[a-f0-9]+$/);

    const task = await service.createEachSignTask({
      launchAccount: 'landlord-mobile',
      fBIds: [upload.bId],
      fileName: 'lease.pdf',
      receiverAccount: '13800000000',
      receiverName: '租客',
      receiverIdCard: '310000000000000000',
    });
    expect(task).toEqual({
      bId: expect.stringMatching(/^mock-task-[a-f0-9]+$/),
      shortCode: expect.stringMatching(/^mock-[a-f0-9]{10}$/),
    });

    const signedFile = await service.downloadSignedFile(task.bId);
    expect(Buffer.isBuffer(signedFile)).toBe(true);
    expect(signedFile.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});

describe('RealWeiQianService', () => {
  const originalEnvironment = Object.fromEntries(
    Object.keys(commonEnvironment).map((key) => [key, process.env[key]]),
  );

  beforeEach(() => {
    Object.assign(process.env, commonEnvironment);
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('upload 使用 multipart/form-data 并携带完整签名头', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ code: 10000, data: { bId: 'file-1' } }));

    await expect(
      new RealWeiQianService().uploadFile(Buffer.from('pdf-content'), '合同.pdf'),
    ).resolves.toEqual({ bId: 'file-1' });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://weiqian.example/openapi/v1/eachSign/upload');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers).toEqual({
      AppId: 'test-app-id',
      Timestamp: '1700000000000',
      AuthMode: 'Signature',
      Sign: createWeiQianSign(
        {
          AppId: 'test-app-id',
          AuthMode: 'Signature',
          Timestamp: '1700000000000',
        },
        'test-app-secret',
      ),
    });
    expect(headers['Content-Type']).toBeUndefined();
    expect(init?.body).toBeInstanceOf(FormData);
    const file = (init?.body as FormData).get('file') as File;
    expect(file).toBeInstanceOf(Blob);
    expect(file.name).toBe('合同.pdf');
  });

  it('create 使用表单 Data，并填入固定实名认证、个人接收方和自动盖章规则', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        code: 10000,
        msg: 'success',
        data: { bId: 'task-1', shortCode: 'short-1' },
      }),
    );

    await expect(
      new RealWeiQianService().createEachSignTask({
        launchAccount: 'landlord-mobile',
        fBIds: ['file-1'],
        fileName: '合同.pdf',
        receiverAccount: '13800000000',
        receiverName: '张三',
        receiverIdCard: '310000000000000000',
        expiresTime: 1701000000000,
        finishSignJumpPage: 'https://tenant.example/sign-complete',
        parm: 'task=local-1',
      }),
    ).resolves.toEqual({ bId: 'task-1', shortCode: 'short-1' });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://weiqian.example/openapi/v1/eachSign/create');
    expect(init?.method).toBe('POST');
    const form = new URLSearchParams(init?.body as string);
    const dataString = form.get('Data');
    expect(dataString).not.toBeNull();
    expect(JSON.parse(dataString as string)).toEqual({
      launchAccount: 'landlord-mobile',
      cId: 1030391,
      fBIds: ['file-1'],
      fileName: '合同.pdf',
      rType: '1',
      authType: '2',
      signType: 1,
      receiverDTOS: [
        {
          account: '13800000000',
          rName: '张三',
          idCard: '310000000000000000',
        },
      ],
      positionDTOS: [{ x: 900, y: 260, pageNum: 1, sealType: 10 }],
      launcherSignRule: [
        { autosealType: 1, x: 280, y: 265, autosealPage: 1, sealId: 37179 },
      ],
      expiresTime: 1701000000000,
      finishSignJumpPage: 'https://tenant.example/sign-complete',
      parm: 'task=local-1',
    });
    const headers = init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(headers.Sign).toBe(
      createWeiQianSign(
        {
          AppId: 'test-app-id',
          AuthMode: 'Signature',
          Data: dataString as string,
          Timestamp: '1700000000000',
        },
        'test-app-secret',
      ),
    );
  });

  it('download 使用表单 Data，返回 PDF Buffer；非文件响应返回 null', async () => {
    // 微签download跟其他接口一样统一走JSON信封响应,文件字节以base64
    // 字符串形式包在data.fileBytes里,不是直接返回二进制流(2026-09-02
    // 用真实签署完成的bId验证时才发现这一点,此前的实现和测试都基于
    // "content-type是json就代表未完成"这个错误假设)
    const pdf = Buffer.from('%PDF-1.4\nsigned\n%%EOF\n');
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          code: 10000,
          data: { fileBytes: pdf.toString('base64') },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ code: 10007, msg: '任务尚未完成签署' }),
      );
    const service = new RealWeiQianService();

    await expect(service.downloadSignedFile('task-1')).resolves.toEqual(pdf);
    const [, init] = fetchSpy.mock.calls[0];
    expect(init?.headers).toMatchObject({
      AppId: 'test-app-id',
      AuthMode: 'Signature',
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    expect(
      JSON.parse(new URLSearchParams(init?.body as string).get('Data') as string),
    ).toEqual({ bId: 'task-1' });

    await expect(service.downloadSignedFile('task-pending')).resolves.toBeNull();
  });

  it('业务 code 非 10000 时抛出包含 code 和 msg 的错误', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ code: 10006, msg: '参数非法' }));

    await expect(
      new RealWeiQianService().uploadFile(Buffer.from('pdf'), '合同.pdf'),
    ).rejects.toThrow('code=10006, msg=参数非法');
  });
});
