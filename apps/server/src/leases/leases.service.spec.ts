import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LeasesService } from './leases.service';
import { PrismaService } from '../prisma/prisma.service';
import { IWechatQrcodeService } from '../wechat/wechat-qrcode.interface';
import { ContractPdfService } from '../contract-pdf/contract-pdf.service';
import { IWeiQianService } from '../weiqian/weiqian.interface';
import { IWechatCustomerServiceService } from '../wechat/wechat-customer-service.interface';
import { IWechatNotifyService } from '../wechat/wechat-notify.interface';
import { BillEngineService } from '../bills/bill-engine.service';

describe('LeasesService contract signing tasks', () => {
  let service: LeasesService;
  let prisma: jest.Mocked<PrismaService>;
  let wechatQrcode: jest.Mocked<IWechatQrcodeService>;
  let contractPdf: jest.Mocked<ContractPdfService>;
  let weiqian: jest.Mocked<IWeiQianService>;
  let wechatCustomer: jest.Mocked<IWechatCustomerServiceService>;
  let wechatNotify: jest.Mocked<IWechatNotifyService>;
  let billEngine: jest.Mocked<BillEngineService>;

  const originalPublicBaseUrl = process.env.SERVER_PUBLIC_BASE_URL;
  const originalSignBaseUrl = process.env.WEIQIAN_SIGN_BASE_URL;

  const dto = {
    type: 'NEW' as const,
    waterMeterReading: 12.5,
    electricityMeterReading: 34.5,
    facilities: [{ name: '空调', has: true }],
  };

  const followedTask = {
    id: 10,
    leaseId: 1,
    type: 'NEW',
    sceneValue: 123456,
    status: 'FOLLOWED',
    followerOpenid: 'openid-tenant',
    waterMeterReading: 12.5,
    electricityMeterReading: 34.5,
    facilities: [
      { name: '空调', has: true },
      { name: '冰箱', has: false },
    ],
    extraTerms: '不得饲养大型宠物',
    weiqianBId: null,
    lease: {
      id: 1,
      coOccupants: [],
      startDate: new Date('2026-09-01'),
      endDate: new Date('2027-08-31'),
      rent: new Prisma.Decimal(1800),
      deposit: new Prisma.Decimal(1800),
      payCycle: 'QUARTERLY',
      room: {
        roomNo: '301',
        building: {
          name: '2号楼',
          property: { name: '阳光公寓' },
        },
      },
      tenant: {
        id: 7,
        name: '张三',
        phone: '13800000000',
        idCard: '310101199001011234',
        openid: null,
      },
    },
  };

  const settings = {
    id: 1,
    landlordName: '李房东',
    landlordIdCard: '310101198001011234',
    landlordPhone: '13900000000',
    defaultPenaltyMonths: 1,
    defaultOverdueDays: 5,
    defaultCleaningFee: new Prisma.Decimal(110),
    defaultRenewNoticeDays: 30,
  };

  beforeEach(() => {
    prisma = {
      lease: { findUnique: jest.fn() },
      tenant: { findUnique: jest.fn(), update: jest.fn() },
      contractSettings: { findFirst: jest.fn() },
      contractSigningTask: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      bill: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
      // M22:生成签约强制要求已有 CHECKIN 交接记录,合同附件三从交接单取数
      handoverRecord: {
        findFirst: jest.fn().mockResolvedValue({
          id: 1,
          leaseId: 1,
          type: 'CHECKIN',
          checklist: [
            { item: '空调', quantity: 1, condition: '完好' },
            { item: '床', quantity: 1, condition: '完好' },
          ],
          createdAt: new Date('2026-09-20T02:00:00Z'),
        }),
      },
      coOccupant: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;
    wechatQrcode = { createSceneQrcode: jest.fn() };
    contractPdf = { generate: jest.fn() } as unknown as jest.Mocked<ContractPdfService>;
    weiqian = {
      uploadFile: jest.fn(),
      createEachSignTask: jest.fn(),
      downloadSignedFile: jest.fn(),
    };
    wechatCustomer = { sendTextMessage: jest.fn() };
    wechatNotify = { sendTemplateMessage: jest.fn().mockResolvedValue(true) };
    billEngine = {
      generateBillsForLease: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<BillEngineService>;
    service = (() => {
      const adminService = { getSettings: () => ({ reminderPreDays: 3 }) } as never;
      return new LeasesService(
      prisma,
      wechatQrcode,
      contractPdf,
      weiqian,
      wechatCustomer,
      wechatNotify,
      adminService,
      billEngine,
    );
    })();
    process.env.SERVER_PUBLIC_BASE_URL = 'https://landlordeasy.cn/api/v1';
    process.env.WEIQIAN_SIGN_BASE_URL = 'https://sign.weiqian.example';
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => {
    if (originalPublicBaseUrl === undefined) delete process.env.SERVER_PUBLIC_BASE_URL;
    else process.env.SERVER_PUBLIC_BASE_URL = originalPublicBaseUrl;
    if (originalSignBaseUrl === undefined) delete process.env.WEIQIAN_SIGN_BASE_URL;
    else process.env.WEIQIAN_SIGN_BASE_URL = originalSignBaseUrl;
  });

  it('租约不存在时抛出 404', async () => {
    (prisma.lease.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.createContractSigningTask(999, dto)).rejects.toThrow(
      new NotFoundException('租约不存在'),
    );
    expect(prisma.contractSigningTask.create).not.toHaveBeenCalled();
    expect(wechatQrcode.createSceneQrcode).not.toHaveBeenCalled();
  });

  it('创建签约记录、生成二维码并返回完整记录', async () => {
    const createdTask = {
      id: 10,
      leaseId: 1,
      type: 'NEW',
      sceneValue: 123456,
      status: 'PENDING_SCAN',
      qrCodeImage: null,
    };
    const completedTask = {
      ...createdTask,
      qrCodeImage: 'data:image/png;base64,qrcode',
    };
    (prisma.lease.findUnique as jest.Mock).mockResolvedValue({
      id: 1,
      tenant: { openid: null },
    });
    (prisma.contractSigningTask.create as jest.Mock).mockResolvedValue(createdTask);
    wechatQrcode.createSceneQrcode.mockResolvedValue({
      ticket: 'ticket-1',
      qrCodeImage: completedTask.qrCodeImage,
    });
    (prisma.contractSigningTask.update as jest.Mock).mockResolvedValue(completedTask);

    await expect(service.createContractSigningTask(1, dto)).resolves.toEqual(
      completedTask,
    );
    expect(prisma.contractSigningTask.create).toHaveBeenCalledWith({
      data: {
        leaseId: 1,
        type: 'NEW',
        sceneValue: expect.any(Number),
        waterMeterReading: 12.5,
        electricityMeterReading: 34.5,
        facilities: [{ name: '空调', has: true }],
        status: 'PENDING_SCAN',
      },
    });
    expect(wechatQrcode.createSceneQrcode).toHaveBeenCalledWith(123456);
  });

  it('sceneValue 唯一约束冲突时重试一次并成功', async () => {
    const uniqueConstraintError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on sceneValue',
      {
        code: 'P2002',
        clientVersion: '6.0.0',
        meta: { target: ['sceneValue'] },
      },
    );
    const createdTask = {
      id: 11,
      sceneValue: 654321,
      status: 'PENDING_SCAN',
      qrCodeImage: null,
    };
    (prisma.lease.findUnique as jest.Mock).mockResolvedValue({
      id: 1,
      tenant: { openid: null },
    });
    (prisma.contractSigningTask.create as jest.Mock)
      .mockRejectedValueOnce(uniqueConstraintError)
      .mockResolvedValueOnce(createdTask);
    wechatQrcode.createSceneQrcode.mockResolvedValue({
      ticket: 'ticket-2',
      qrCodeImage: 'data:image/png;base64,retried-qrcode',
    });
    (prisma.contractSigningTask.update as jest.Mock).mockResolvedValue({
      ...createdTask,
      qrCodeImage: 'data:image/png;base64,retried-qrcode',
    });

    await expect(
      service.createContractSigningTask(1, { type: 'RENEW' }),
    ).resolves.toBeDefined();
    expect(prisma.contractSigningTask.create).toHaveBeenCalledTimes(2);
  });

  it('租客已有 openid 时跳过二维码并自动发起签署', async () => {
    const createdTask = { ...followedTask };
    const updatedTask = { ...followedTask, status: 'CREATED' };
    (prisma.lease.findUnique as jest.Mock).mockResolvedValue({
      id: 1,
      tenant: { openid: 'openid-tenant' },
    });
    (prisma.contractSigningTask.create as jest.Mock).mockResolvedValue(createdTask);
    (prisma.contractSigningTask.findUnique as jest.Mock).mockResolvedValue(followedTask);
    (prisma.contractSettings.findFirst as jest.Mock).mockResolvedValue(settings);
    (prisma.contractSigningTask.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    contractPdf.generate.mockResolvedValue(Buffer.from('%PDF-test'));
    weiqian.uploadFile.mockResolvedValue({ bId: 'file-bid' });
    weiqian.createEachSignTask.mockResolvedValue({
      bId: 'task-bid',
      shortCode: 'short-code',
    });
    (prisma.contractSigningTask.update as jest.Mock).mockResolvedValue(updatedTask);
    wechatCustomer.sendTextMessage.mockResolvedValue(true);

    await expect(service.createContractSigningTask(1, dto)).resolves.toEqual(
      updatedTask,
    );
    expect(prisma.contractSigningTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leaseId: 1,
        status: 'FOLLOWED',
        followerOpenid: 'openid-tenant',
      }),
    });
    expect(wechatQrcode.createSceneQrcode).not.toHaveBeenCalled();
    expect(weiqian.createEachSignTask).toHaveBeenCalledTimes(1);
    expect(prisma.contractSigningTask.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: {
        status: 'CREATED',
        weiqianBId: 'task-bid',
        weiqianShortCode: 'short-code',
        signCallbackToken: expect.any(String),
      },
    });
    expect(wechatCustomer.sendTextMessage).toHaveBeenCalledWith(
      'openid-tenant',
      '【2号楼301】您的租房合同可以签署了,请点击链接完成实名认证并签字(建议在微信内直接打开):\n' +
        'https://sign.weiqian.example/q/short-code\n' +
        '链接7天内有效,请尽快完成',
    );
  });

  it('租客已有 openid 但 provider 结果不确定时保留任务且不自动重试', async () => {
    const createdTask = { ...followedTask };
    (prisma.lease.findUnique as jest.Mock).mockResolvedValue({
      id: 1,
      tenant: { openid: 'openid-tenant' },
    });
    (prisma.contractSigningTask.create as jest.Mock).mockResolvedValue(createdTask);
    (prisma.contractSigningTask.findUnique as jest.Mock).mockResolvedValue(followedTask);
    (prisma.contractSettings.findFirst as jest.Mock).mockResolvedValue(settings);
    (prisma.contractSigningTask.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    contractPdf.generate.mockResolvedValue(Buffer.from('%PDF-test'));
    weiqian.uploadFile.mockResolvedValue({ bId: 'file-bid' });
    weiqian.createEachSignTask.mockRejectedValue(new Error('微签暂不可用'));
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await expect(service.createContractSigningTask(1, dto)).resolves.toEqual(
      createdTask,
    );
    expect(createdTask.status).toBe('FOLLOWED');
    expect(wechatQrcode.createSceneQrcode).not.toHaveBeenCalled();
    expect(prisma.contractSigningTask.update).not.toHaveBeenCalled();
    expect(prisma.contractSigningTask.updateMany).toHaveBeenCalledWith({
      where: { id: 10, status: 'FOLLOWED' },
      data: { status: 'LAUNCHING' },
    });
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('自动发起失败'));
  });

  it('非 FOLLOWED 状态拒绝发起签署', async () => {
    (prisma.contractSigningTask.findUnique as jest.Mock).mockResolvedValue({
      ...followedTask,
      status: 'PENDING_SCAN',
    });

    await expect(service.launchContractSigningTask(10, {})).rejects.toThrow(
      new BadRequestException('当前状态不允许发起签署,需要租客先关注公众号'),
    );
    expect(prisma.contractSettings.findFirst).not.toHaveBeenCalled();
    expect(contractPdf.generate).not.toHaveBeenCalled();
  });

  it('ContractSettings 不存在时提示先配置甲方信息', async () => {
    (prisma.contractSigningTask.findUnique as jest.Mock).mockResolvedValue(followedTask);
    (prisma.contractSettings.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(service.launchContractSigningTask(10, {})).rejects.toThrow(
      '尚未配置合同甲方信息,请先到系统设置完成合同签约配置',
    );
    expect(contractPdf.generate).not.toHaveBeenCalled();
  });

  it('成功生成 PDF、上传并创建微签任务、推送链接且转为 CREATED', async () => {
    const pdf = Buffer.from('%PDF-test');
    const updatedTask = { ...followedTask, status: 'CREATED' };
    (prisma.contractSigningTask.findUnique as jest.Mock).mockResolvedValue(followedTask);
    (prisma.contractSettings.findFirst as jest.Mock).mockResolvedValue(settings);
    (prisma.contractSigningTask.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    contractPdf.generate.mockResolvedValue(pdf);
    weiqian.uploadFile.mockResolvedValue({ bId: 'file-bid' });
    weiqian.createEachSignTask.mockResolvedValue({
      bId: 'task-bid',
      shortCode: 'short-code',
    });
    (prisma.contractSigningTask.update as jest.Mock).mockResolvedValue(updatedTask);
    wechatCustomer.sendTextMessage.mockResolvedValue(true);
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    await expect(
      service.launchContractSigningTask(10, {
        penaltyMonths: 2,
        overdueToleranceDays: 7,
        cleaningFee: 150,
        renewalNoticeDays: 45,
      }),
    ).resolves.toEqual(updatedTask);

    expect(contractPdf.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        landlordName: '李房东',
        tenantName: '张三',
        propertyAddress: '阳光公寓2号楼301室',
        paymentCycle: 'QUARTERLY',
        penaltyMonths: 2,
        overdueToleranceDays: 7,
        cleaningFee: 150,
        renewalNoticeDays: 45,
        payeeName: '占秀英',
        advancePaymentDays: 3,
        checklist: [
          { item: '空调', quantity: 1, condition: '完好' },
          { item: '床', quantity: 1, condition: '完好' },
        ],
        coOccupants: [],
        extraTerms: '不得饲养大型宠物',
      }),
    );
    expect(weiqian.uploadFile).toHaveBeenCalledWith(pdf, 'contract-10.pdf');
    expect(weiqian.createEachSignTask).toHaveBeenCalledWith({
      launchAccount: '13900000000',
      fBIds: ['file-bid'],
      fileName: 'contract-10.pdf',
      receiverAccount: '13800000000',
      receiverName: '张三',
      receiverIdCard: '310101199001011234',
      expiresTime: 1_700_604_800_000,
      sendSmsToReceiver: true,
      finishSignJumpPage:
        'https://landlordeasy.cn/api/v1/wechat/contract-sign-callback',
      parm: expect.any(String),
    });
    expect(prisma.contractSigningTask.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: {
        status: 'CREATED',
        weiqianBId: 'task-bid',
        weiqianShortCode: 'short-code',
        signCallbackToken: expect.any(String),
      },
    });
    expect(wechatCustomer.sendTextMessage).toHaveBeenCalledWith(
      'openid-tenant',
      '【2号楼301】您的租房合同可以签署了,请点击链接完成实名认证并签字(建议在微信内直接打开):\n' +
        'https://sign.weiqian.example/q/short-code\n' +
        '链接7天内有效,请尽快完成',
    );
  });

  it('并发发起签约只有取得持久化 claim 的请求可调用 provider', async () => {
    (prisma.contractSigningTask.findUnique as jest.Mock).mockResolvedValue(followedTask);
    (prisma.contractSettings.findFirst as jest.Mock).mockResolvedValue(settings);
    (prisma.contractSigningTask.updateMany as jest.Mock)
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    contractPdf.generate.mockResolvedValue(Buffer.from('%PDF-test'));
    weiqian.uploadFile.mockResolvedValue({ bId: 'file-bid' });
    weiqian.createEachSignTask.mockResolvedValue({ bId: 'task-bid', shortCode: 'short-code' });
    (prisma.contractSigningTask.update as jest.Mock).mockResolvedValue({
      ...followedTask,
      status: 'CREATED',
    });
    wechatCustomer.sendTextMessage.mockResolvedValue(true);

    const results = await Promise.allSettled([
      service.launchContractSigningTask(10, {}),
      service.launchContractSigningTask(10, {}),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(weiqian.uploadFile).toHaveBeenCalledTimes(1);
    expect(weiqian.createEachSignTask).toHaveBeenCalledTimes(1);
  });

  it('PDF 生成失败发生在 provider 调用前并释放 claim 供安全重试', async () => {
    (prisma.contractSigningTask.findUnique as jest.Mock).mockResolvedValue(followedTask);
    (prisma.contractSettings.findFirst as jest.Mock).mockResolvedValue(settings);
    (prisma.contractSigningTask.updateMany as jest.Mock)
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    contractPdf.generate.mockRejectedValue(new Error('injected PDF failure'));

    await expect(service.launchContractSigningTask(10, {})).rejects.toThrow(
      'injected PDF failure',
    );
    expect(weiqian.uploadFile).not.toHaveBeenCalled();
    expect(prisma.contractSigningTask.updateMany).toHaveBeenLastCalledWith({
      where: { id: 10, status: 'LAUNCHING' },
      data: { status: 'FOLLOWED' },
    });
  });

  it('provider 成功后客服消息失败仍返回 CREATED,且不会再次调用 provider', async () => {
    (prisma.contractSigningTask.findUnique as jest.Mock).mockResolvedValue(followedTask);
    (prisma.contractSettings.findFirst as jest.Mock).mockResolvedValue(settings);
    (prisma.contractSigningTask.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    contractPdf.generate.mockResolvedValue(Buffer.from('%PDF-test'));
    weiqian.uploadFile.mockResolvedValue({ bId: 'file-bid' });
    weiqian.createEachSignTask.mockResolvedValue({ bId: 'task-bid', shortCode: 'short-code' });
    (prisma.contractSigningTask.update as jest.Mock).mockResolvedValue({
      ...followedTask,
      status: 'CREATED',
      weiqianBId: 'task-bid',
    });
    wechatCustomer.sendTextMessage.mockRejectedValue(new Error('injected message failure'));

    await expect(service.launchContractSigningTask(10, {})).resolves.toEqual(
      expect.objectContaining({ status: 'CREATED', weiqianBId: 'task-bid' }),
    );
    expect(prisma.contractSigningTask.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: {
        status: 'CREATED',
        weiqianBId: 'task-bid',
        weiqianShortCode: 'short-code',
        signCallbackToken: expect.any(String),
      },
    });
    expect(weiqian.uploadFile).toHaveBeenCalledTimes(1);
    expect(weiqian.createEachSignTask).toHaveBeenCalledTimes(1);
  });

  it('provider 成功后的本地写入只重试数据库,不会重复调用 provider', async () => {
    (prisma.contractSigningTask.findUnique as jest.Mock).mockResolvedValue(followedTask);
    (prisma.contractSettings.findFirst as jest.Mock).mockResolvedValue(settings);
    (prisma.contractSigningTask.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    contractPdf.generate.mockResolvedValue(Buffer.from('%PDF-test'));
    weiqian.uploadFile.mockResolvedValue({ bId: 'file-bid' });
    weiqian.createEachSignTask.mockResolvedValue({ bId: 'task-bid', shortCode: 'short-code' });
    (prisma.contractSigningTask.update as jest.Mock)
      .mockRejectedValueOnce(new Error('transient database failure'))
      .mockResolvedValue({ ...followedTask, status: 'CREATED', weiqianBId: 'task-bid' });
    wechatCustomer.sendTextMessage.mockResolvedValue(true);

    await expect(service.launchContractSigningTask(10, {})).resolves.toEqual(
      expect.objectContaining({ status: 'CREATED', weiqianBId: 'task-bid' }),
    );
    expect(prisma.contractSigningTask.update).toHaveBeenCalledTimes(2);
    expect(weiqian.uploadFile).toHaveBeenCalledTimes(1);
    expect(weiqian.createEachSignTask).toHaveBeenCalledTimes(1);
  });

  it('tryConfirmSigned 对非 CREATED 状态幂等跳过', async () => {
    (prisma.contractSigningTask.findUnique as jest.Mock).mockResolvedValue({
      ...followedTask,
      status: 'SIGNED',
    });

    await expect(service.tryConfirmSigned(10)).resolves.toBe(false);
    expect(weiqian.downloadSignedFile).not.toHaveBeenCalled();
    expect(prisma.contractSigningTask.updateMany).not.toHaveBeenCalled();
  });

  it('download 返回 null 时保持 CREATED 且不报错', async () => {
    (prisma.contractSigningTask.findUnique as jest.Mock).mockResolvedValue({
      ...followedTask,
      status: 'CREATED',
      weiqianBId: 'task-bid',
    });
    weiqian.downloadSignedFile.mockResolvedValue(null);

    await expect(service.tryConfirmSigned(10)).resolves.toBe(false);
    expect(prisma.contractSigningTask.updateMany).not.toHaveBeenCalled();
    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });

  it('download 返回 PDF 时归档、转 SIGNED 并自动绑定 openid', async () => {
    const originalTemplateId = process.env.WECHAT_TEMPLATE_CONTRACT_SIGNED;
    process.env.WECHAT_TEMPLATE_CONTRACT_SIGNED = 'tpl-contract-signed';
    const signedPdf = Buffer.from('%PDF-signed');
    (prisma.contractSigningTask.findUnique as jest.Mock).mockResolvedValue({
      ...followedTask,
      status: 'CREATED',
      weiqianBId: 'task-bid',
    });
    weiqian.downloadSignedFile.mockResolvedValue(signedPdf);
    (prisma.contractSigningTask.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.tenant.update as jest.Mock).mockResolvedValue({});
    const saveSpy = jest
      .spyOn(service as unknown as { saveSignedPdf: (id: number, pdf: Buffer) => string }, 'saveSignedPdf')
      .mockReturnValue('/uploads/contract-10-signed.pdf');

    try {
      await expect(service.tryConfirmSigned(10)).resolves.toBe(true);
      expect(saveSpy).toHaveBeenCalledWith(10, signedPdf);
      expect(prisma.contractSigningTask.updateMany).toHaveBeenCalledWith({
        where: { id: 10, status: 'CREATED' },
        data: {
          status: 'SIGNED',
          signedPdfUrl: '/uploads/contract-10-signed.pdf',
          signedAt: expect.any(Date),
        },
      });
      expect(billEngine.generateBillsForLease).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, deposit: new Prisma.Decimal(1800) }),
        { includeDeposit: true },
      );
      expect(prisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { openid: 'openid-tenant' },
      });
      expect(wechatCustomer.sendTextMessage).toHaveBeenCalledWith(
        'openid-tenant',
        '【2号楼301】您的租房合同已签署完成,感谢配合。如有疑问请直接联系房东',
      );
      expect(wechatNotify.sendTemplateMessage).toHaveBeenCalledWith({
        openid: 'openid-tenant',
        templateId: 'tpl-contract-signed',
        data: {
          thing1: { value: '阳光公寓2号楼301室' },
          character_string2: { value: 'LE-10' },
          const3: { value: '公寓房屋租赁合同' },
          time4: { value: '2026-09-01~2027-08-31' },
          thing5: { value: '张三' },
        },
      });
    } finally {
      if (originalTemplateId === undefined) delete process.env.WECHAT_TEMPLATE_CONTRACT_SIGNED;
      else process.env.WECHAT_TEMPLATE_CONTRACT_SIGNED = originalTemplateId;
    }
  });

  it('首期账单生成失败时记录错误但签署确认仍成功', async () => {
    (prisma.contractSigningTask.findUnique as jest.Mock).mockResolvedValue({
      ...followedTask,
      status: 'CREATED',
      weiqianBId: 'task-bid',
    });
    weiqian.downloadSignedFile.mockResolvedValue(Buffer.from('%PDF-signed'));
    (prisma.contractSigningTask.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.tenant.update as jest.Mock).mockResolvedValue({});
    billEngine.generateBillsForLease.mockRejectedValue(new Error('bill failed'));
    jest
      .spyOn(service as unknown as { saveSignedPdf: (id: number, pdf: Buffer) => string }, 'saveSignedPdf')
      .mockReturnValue('/uploads/contract-10-signed.pdf');
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    await expect(service.tryConfirmSigned(10)).resolves.toBe(true);
    expect(prisma.tenant.update).toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('首期账单生成失败: bill failed'),
    );
  });

  it('首期账单生成后发送带付款跳转的催缴模板消息', async () => {
    const originalTemplateId = process.env.WECHAT_TEMPLATE_RENT_REMINDER;
    process.env.WECHAT_TEMPLATE_RENT_REMINDER = 'tpl-rent-reminder';
    (prisma.contractSigningTask.findUnique as jest.Mock).mockResolvedValue({
      ...followedTask,
      status: 'CREATED',
      weiqianBId: 'task-bid',
    });
    weiqian.downloadSignedFile.mockResolvedValue(Buffer.from('%PDF-signed'));
    (prisma.contractSigningTask.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.tenant.update as jest.Mock).mockResolvedValue({});
    billEngine.generateBillsForLease.mockResolvedValue(1);
    (prisma.bill.findFirst as jest.Mock).mockResolvedValue({
      id: 88,
      totalAmount: new Prisma.Decimal(3030),
      periodStart: new Date('2026-09-01T00:00:00.000Z'),
      periodEnd: new Date('2026-11-30T00:00:00.000Z'),
      dueDate: new Date('2026-09-01T00:00:00.000Z'),
      lease: { room: followedTask.lease.room },
    });
    jest
      .spyOn(service as unknown as { saveSignedPdf: (id: number, pdf: Buffer) => string }, 'saveSignedPdf')
      .mockReturnValue('/uploads/contract-10-signed.pdf');

    try {
      await expect(service.tryConfirmSigned(10)).resolves.toBe(true);
      expect(wechatNotify.sendTemplateMessage).toHaveBeenCalledWith({
        openid: 'openid-tenant',
        templateId: 'tpl-rent-reminder',
        url: 'https://landlordeasy.cn/tenant/bills/88/pay',
        data: {
          amount3: { value: '3030' },
          time4: { value: '2026-09-01~2026-11-30' },
          thing5: { value: '房租账单' },
          thing7: { value: '阳光公寓2号楼301' },
          time10: { value: '2026-09-01' },
        },
      });
    } finally {
      if (originalTemplateId === undefined) delete process.env.WECHAT_TEMPLATE_RENT_REMINDER;
      else process.env.WECHAT_TEMPLATE_RENT_REMINDER = originalTemplateId;
    }
  });

  it('未配置 WECHAT_TEMPLATE_CONTRACT_SIGNED 时不发送签署完成模板消息', async () => {
    const originalTemplateId = process.env.WECHAT_TEMPLATE_CONTRACT_SIGNED;
    delete process.env.WECHAT_TEMPLATE_CONTRACT_SIGNED;
    const signedPdf = Buffer.from('%PDF-signed');
    (prisma.contractSigningTask.findUnique as jest.Mock).mockResolvedValue({
      ...followedTask,
      status: 'CREATED',
      weiqianBId: 'task-bid',
    });
    weiqian.downloadSignedFile.mockResolvedValue(signedPdf);
    (prisma.contractSigningTask.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.tenant.update as jest.Mock).mockResolvedValue({});
    jest
      .spyOn(service as unknown as { saveSignedPdf: (id: number, pdf: Buffer) => string }, 'saveSignedPdf')
      .mockReturnValue('/uploads/contract-10-signed.pdf');

    try {
      await expect(service.tryConfirmSigned(10)).resolves.toBe(true);
      expect(wechatNotify.sendTemplateMessage).not.toHaveBeenCalled();
    } finally {
      if (originalTemplateId === undefined) delete process.env.WECHAT_TEMPLATE_CONTRACT_SIGNED;
      else process.env.WECHAT_TEMPLATE_CONTRACT_SIGNED = originalTemplateId;
    }
  });

  it('确认签署成功但任务没有 followerOpenid 时不发送签署完成通知', async () => {
    const signedPdf = Buffer.from('%PDF-signed');
    (prisma.contractSigningTask.findUnique as jest.Mock).mockResolvedValue({
      ...followedTask,
      status: 'CREATED',
      weiqianBId: 'task-bid',
      followerOpenid: null,
    });
    weiqian.downloadSignedFile.mockResolvedValue(signedPdf);
    (prisma.contractSigningTask.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    jest
      .spyOn(service as unknown as { saveSignedPdf: (id: number, pdf: Buffer) => string }, 'saveSignedPdf')
      .mockReturnValue('/uploads/contract-10-signed.pdf');

    await expect(service.tryConfirmSigned(10)).resolves.toBe(true);
    expect(wechatCustomer.sendTextMessage).not.toHaveBeenCalled();
  });

  it('租客已有不同 openid 时记录 warning 且不覆盖', async () => {
    (prisma.contractSigningTask.findUnique as jest.Mock).mockResolvedValue({
      ...followedTask,
      status: 'CREATED',
      weiqianBId: 'task-bid',
      lease: {
        ...followedTask.lease,
        tenant: { ...followedTask.lease.tenant, openid: 'openid-existing' },
      },
    });
    weiqian.downloadSignedFile.mockResolvedValue(Buffer.from('%PDF-signed'));
    (prisma.contractSigningTask.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    jest
      .spyOn(service as unknown as { saveSignedPdf: (id: number, pdf: Buffer) => string }, 'saveSignedPdf')
      .mockReturnValue('/uploads/contract-10-signed.pdf');
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await expect(service.tryConfirmSigned(10)).resolves.toBe(true);
    expect(prisma.tenant.update).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('openid 冲突'));
  });

  describe('getOrCreateTenantBindQrcode', () => {
    it('租约不存在时抛出 404', async () => {
      (prisma.lease.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getOrCreateTenantBindQrcode(999)).rejects.toThrow(
        new NotFoundException('租约不存在'),
      );
      expect(wechatQrcode.createSceneQrcode).not.toHaveBeenCalled();
    });

    it('租客尚无绑定场景值时生成新的场景值并返回二维码', async () => {
      (prisma.lease.findUnique as jest.Mock).mockResolvedValue({ tenantId: 7 });
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({ bindSceneValue: null });
      (prisma.tenant.update as jest.Mock).mockResolvedValue({ bindSceneValue: 999888 });
      wechatQrcode.createSceneQrcode.mockResolvedValue({
        ticket: 'ticket-bind',
        qrCodeImage: 'data:image/png;base64,bindqrcode',
      });

      await expect(service.getOrCreateTenantBindQrcode(1)).resolves.toEqual({
        qrCodeImage: 'data:image/png;base64,bindqrcode',
        sceneValue: 999888,
      });
      expect(prisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { bindSceneValue: expect.any(Number) },
        select: { bindSceneValue: true },
      });
      expect(wechatQrcode.createSceneQrcode).toHaveBeenCalledWith(999888);
    });

    it('租客已有绑定场景值时直接复用,不重新生成', async () => {
      (prisma.lease.findUnique as jest.Mock).mockResolvedValue({ tenantId: 7 });
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({ bindSceneValue: 555444 });
      wechatQrcode.createSceneQrcode.mockResolvedValue({
        ticket: 'ticket-bind',
        qrCodeImage: 'data:image/png;base64,bindqrcode',
      });

      await expect(service.getOrCreateTenantBindQrcode(1)).resolves.toEqual({
        qrCodeImage: 'data:image/png;base64,bindqrcode',
        sceneValue: 555444,
      });
      expect(prisma.tenant.update).not.toHaveBeenCalled();
      expect(wechatQrcode.createSceneQrcode).toHaveBeenCalledWith(555444);
    });
  });

  describe('M22 共同居住人与交接前置校验', () => {
    it('配置了发起签署模板ID时,CREATED后并行发送模板消息且带签署链接', async () => {
      process.env.WECHAT_TEMPLATE_CONTRACT_LAUNCH = 'tpl-launch-test';
      try {
        (prisma.lease.findUnique as jest.Mock).mockResolvedValue({
          id: 1,
          tenant: { openid: 'openid-tenant' },
        });
        (prisma.handoverRecord.findFirst as jest.Mock).mockResolvedValue({
          id: 1, leaseId: 1, type: 'CHECKIN', checklist: [], createdAt: new Date(),
        });
        (prisma.contractSigningTask.create as jest.Mock).mockResolvedValue(followedTask);
        (prisma.contractSigningTask.findUnique as jest.Mock).mockResolvedValue(followedTask);
        (prisma.contractSettings.findFirst as jest.Mock).mockResolvedValue(settings);
        (prisma.contractSigningTask.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
        contractPdf.generate.mockResolvedValue(Buffer.from('%PDF-test'));
        weiqian.uploadFile.mockResolvedValue({ bId: 'file-bid' });
        weiqian.createEachSignTask.mockResolvedValue({ bId: 'task-bid', shortCode: 'SC-1' });
        (prisma.contractSigningTask.update as jest.Mock).mockResolvedValue({ ...followedTask, status: 'CREATED' });
        wechatCustomer.sendTextMessage.mockResolvedValue(true);
        wechatNotify.sendTemplateMessage.mockResolvedValue(true);

        await service.createContractSigningTask(1, { type: 'NEW' } as never);

        expect(wechatNotify.sendTemplateMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            templateId: 'tpl-launch-test',
            url: expect.stringContaining('/q/SC-1'),
          }),
        );
      } finally {
        delete process.env.WECHAT_TEMPLATE_CONTRACT_LAUNCH;
      }
    });

    it('发起签署时CHECKIN交接记录已被删除→400拦截(评审P1#1)', async () => {
      (prisma.contractSigningTask.findUnique as jest.Mock).mockResolvedValue({
        ...followedTask,
      });
      (prisma.contractSettings.findFirst as jest.Mock).mockResolvedValue(settings);
      (prisma.contractSigningTask.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.handoverRecord.findFirst as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.launchContractSigningTask(10, {}),
      ).rejects.toThrow('入住交接记录已被删除');
    });

    it('无 CHECKIN 交接记录时禁止生成电子签约', async () => {
      (prisma.lease.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        tenant: { openid: null },
      });
      (prisma.handoverRecord.findFirst as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.createContractSigningTask(1, { type: 'NEW' } as never),
      ).rejects.toThrow('请先在租约详情页填写"入住交接记录"');
    });

    it('新增共同居住人:校验租约存在后创建', async () => {
      (prisma.lease.findUnique as jest.Mock).mockResolvedValue({ id: 1 });
      (prisma.coOccupant.create as jest.Mock).mockResolvedValue({
        id: 5, leaseId: 1, name: '张同住', idCard: '310101199001011234', phone: '13800001111',
      });

      await expect(
        service.addCoOccupant(1, { name: '张同住', idCard: '310101199001011234', phone: '13800001111' } as never),
      ).resolves.toEqual({ id: 5, leaseId: 1, name: '张同住', idCard: '310101199001011234', phone: '13800001111' });
      expect(prisma.coOccupant.create).toHaveBeenCalledWith({
        data: { leaseId: 1, name: '张同住', idCard: '310101199001011234', phone: '13800001111' },
      });
    });

    it('更新/删除共同居住人:不存在时404', async () => {
      (prisma.coOccupant.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(
        service.updateCoOccupant(99, { name: 'x' } as never),
      ).rejects.toThrow('共同居住人不存在');
      await expect(service.removeCoOccupant(99)).rejects.toThrow('共同居住人不存在');
    });

    it('删除共同居住人成功', async () => {
      (prisma.coOccupant.findUnique as jest.Mock).mockResolvedValue({ id: 5, leaseId: 1 });
      (prisma.coOccupant.delete as jest.Mock).mockResolvedValue({ id: 5 });
      await expect(service.removeCoOccupant(5)).resolves.toEqual({ deleted: true });
      expect(prisma.coOccupant.delete).toHaveBeenCalledWith({ where: { id: 5 } });
    });
  });
});
