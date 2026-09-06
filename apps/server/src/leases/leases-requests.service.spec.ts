import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LeasesService } from './leases.service';
import { PrismaService } from '../prisma/prisma.service';
import { IWechatQrcodeService } from '../wechat/wechat-qrcode.interface';
import { ContractPdfService } from '../contract-pdf/contract-pdf.service';
import { IWeiQianService } from '../weiqian/weiqian.interface';
import { IWechatCustomerServiceService } from '../wechat/wechat-customer-service.interface';
import { IWechatNotifyService } from '../wechat/wechat-notify.interface';

describe('LeasesService 退租违约/换租申请', () => {
  let service: LeasesService;
  let prisma: jest.Mocked<PrismaService>;
  let wechatQrcode: jest.Mocked<IWechatQrcodeService>;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn((callback) => callback(prisma)),
      $queryRaw: jest.fn(),
      lease: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      room: { findUnique: jest.fn(), update: jest.fn() },
      tenant: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
      contractSigningTask: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
      contractSettings: { findFirst: jest.fn() },
      leaseTerminationRequest: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      roomTransferRequest: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      bill: { create: jest.fn() },
      billItem: { create: jest.fn() },
      depositRecord: { create: jest.fn() },
    } as unknown as jest.Mocked<PrismaService>;

    wechatQrcode = {
      createSceneQrcode: jest.fn(),
    };
    const contractPdf = { generate: jest.fn() } as unknown as jest.Mocked<ContractPdfService>;
    const weiqian: jest.Mocked<IWeiQianService> = {
      uploadFile: jest.fn(),
      createEachSignTask: jest.fn(),
      downloadSignedFile: jest.fn(),
    };
    const wechatCustomer: jest.Mocked<IWechatCustomerServiceService> = {
      sendTextMessage: jest.fn(),
    };
    const wechatNotify: jest.Mocked<IWechatNotifyService> = {
      sendTemplateMessage: jest.fn(),
    };

    service = new LeasesService(
      prisma,
      wechatQrcode,
      contractPdf,
      weiqian,
      wechatCustomer,
      wechatNotify,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('createTerminationRequest', () => {
    it('租约不存在或不属于该租客时抛404', async () => {
      (prisma.lease.findUnique as jest.Mock).mockResolvedValue({ id: 1, tenantId: 99, status: 'ACTIVE' });
      await expect(
        service.createTerminationRequest(1, 1, { requestedMoveOutDate: '2026-10-01' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('租约已结束时拒绝', async () => {
      (prisma.lease.findUnique as jest.Mock).mockResolvedValue({ id: 1, tenantId: 1, status: 'ENDED' });
      await expect(
        service.createTerminationRequest(1, 1, { requestedMoveOutDate: '2026-10-01' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('已有待处理申请时拒绝重复提交', async () => {
      (prisma.lease.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        tenantId: 1,
        status: 'ACTIVE',
        rent: new Prisma.Decimal(1800),
      });
      (prisma.leaseTerminationRequest.findFirst as jest.Mock).mockResolvedValue({ id: 5 });
      await expect(
        service.createTerminationRequest(1, 1, { requestedMoveOutDate: '2026-10-01' }),
      ).rejects.toThrow('已有一条待处理的退租申请');
    });

    it('按合同签约任务的违约金月数计算建议违约金', async () => {
      (prisma.lease.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        tenantId: 1,
        status: 'ACTIVE',
        rent: new Prisma.Decimal(1800),
      });
      (prisma.leaseTerminationRequest.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.contractSigningTask.findFirst as jest.Mock).mockResolvedValue({ penaltyMonths: 2 });
      (prisma.leaseTerminationRequest.create as jest.Mock).mockImplementation(({ data }) => data);

      const result = await service.createTerminationRequest(1, 1, {
        requestedMoveOutDate: '2026-10-01',
      });
      expect(result.suggestedPenalty).toBe(3600);
    });

    it('没有电子签约记录时退回默认违约金月数', async () => {
      (prisma.lease.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        tenantId: 1,
        status: 'ACTIVE',
        rent: new Prisma.Decimal(1800),
      });
      (prisma.leaseTerminationRequest.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.contractSigningTask.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.contractSettings.findFirst as jest.Mock).mockResolvedValue({ defaultPenaltyMonths: 3 });
      (prisma.leaseTerminationRequest.create as jest.Mock).mockImplementation(({ data }) => data);

      const result = await service.createTerminationRequest(1, 1, {
        requestedMoveOutDate: '2026-10-01',
      });
      expect(result.suggestedPenalty).toBe(5400);
    });
  });

  describe('approveTerminationRequest', () => {
    const baseRequest = {
      id: 7,
      leaseId: 1,
      status: 'PENDING',
      suggestedPenalty: new Prisma.Decimal(1800),
      requestedMoveOutDate: new Date('2026-10-01'),
      lease: { deposit: new Prisma.Decimal(1800) },
    };

    it('违约金不超过押金时全额从押金抵扣,不生成补差账单', async () => {
      (prisma.leaseTerminationRequest.findUnique as jest.Mock).mockResolvedValue(baseRequest);
      (prisma.lease.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        roomId: 2,
        status: 'ACTIVE',
        deposit: new Prisma.Decimal(1800),
      });
      (prisma.lease.update as jest.Mock).mockResolvedValue({ status: 'ENDED' });
      (prisma.leaseTerminationRequest.update as jest.Mock).mockImplementation(({ data }) => data);

      const result = await service.approveTerminationRequest(7, {}, 1);

      expect(prisma.depositRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ leaseId: 1, type: 'DEDUCT', amount: 1800 }),
      });
      expect(prisma.lease.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ENDED' }) }),
      );
      expect(prisma.bill.create).not.toHaveBeenCalled();
      expect(result.finalPenalty).toBe(1800);
    });

    it('违约金超过押金时押金全扣+生成补差账单', async () => {
      (prisma.leaseTerminationRequest.findUnique as jest.Mock).mockResolvedValue(baseRequest);
      (prisma.lease.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        roomId: 2,
        status: 'ACTIVE',
        deposit: new Prisma.Decimal(1800),
      });
      (prisma.lease.update as jest.Mock).mockResolvedValue({ status: 'ENDED' });
      (prisma.bill.create as jest.Mock).mockResolvedValue({ id: 99 });
      (prisma.leaseTerminationRequest.update as jest.Mock).mockImplementation(({ data }) => data);

      const result = await service.approveTerminationRequest(7, { finalPenalty: 3000 }, 1);

      expect(prisma.bill.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ leaseId: 1, totalAmount: 1200 }),
        }),
      );
      expect(prisma.billItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: '违约金差额', amount: 1200 }),
        }),
      );
      expect(result.finalPenalty).toBe(3000);
    });

    it('任一中间写入失败时事务拒绝且申请不会在事务内标记为已批准', async () => {
      (prisma.leaseTerminationRequest.findUnique as jest.Mock).mockResolvedValue(baseRequest);
      (prisma.lease.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        roomId: 2,
        status: 'ACTIVE',
        deposit: new Prisma.Decimal(1800),
      });
      (prisma.lease.update as jest.Mock).mockResolvedValue({ status: 'ENDED' });
      (prisma.bill.create as jest.Mock).mockResolvedValue({ id: 99 });
      (prisma.billItem.create as jest.Mock).mockRejectedValue(new Error('injected bill item failure'));

      await expect(
        service.approveTerminationRequest(7, { finalPenalty: 3000 }, 1),
      ).rejects.toThrow('injected bill item failure');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.leaseTerminationRequest.update).not.toHaveBeenCalled();
    });

    it('已批准申请重复审批时返回原结果且不重复写入', async () => {
      (prisma.leaseTerminationRequest.findUnique as jest.Mock).mockResolvedValue({
        ...baseRequest,
        status: 'APPROVED',
      });
      await expect(service.approveTerminationRequest(7, {}, 1)).resolves.toEqual(
        expect.objectContaining({ id: 7, status: 'APPROVED' }),
      );
      expect(prisma.depositRecord.create).not.toHaveBeenCalled();
      expect(prisma.leaseTerminationRequest.update).not.toHaveBeenCalled();
    });

    it('并发重复批准串行化为一次结算', async () => {
      let status = 'PENDING';
      let tail = Promise.resolve<unknown>(undefined);
      (prisma.$transaction as jest.Mock).mockImplementation((callback) => {
        const run = tail.then(() => callback(prisma));
        tail = run.catch(() => undefined);
        return run;
      });
      (prisma.leaseTerminationRequest.findUnique as jest.Mock).mockImplementation(async () => ({
        ...baseRequest,
        status,
      }));
      (prisma.lease.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        roomId: 2,
        status: 'ACTIVE',
        deposit: new Prisma.Decimal(1800),
      });
      (prisma.lease.update as jest.Mock).mockResolvedValue({ status: 'ENDED' });
      (prisma.leaseTerminationRequest.update as jest.Mock).mockImplementation(async ({ data }) => {
        status = data.status;
        return { ...baseRequest, ...data };
      });

      const results = await Promise.all([
        service.approveTerminationRequest(7, {}, 1),
        service.approveTerminationRequest(7, {}, 1),
      ]);
      expect(results).toHaveLength(2);
      expect(prisma.leaseTerminationRequest.update).toHaveBeenCalledTimes(1);
      expect(prisma.lease.update).toHaveBeenCalledTimes(1);
      expect(prisma.depositRecord.create).toHaveBeenCalledTimes(1);
    });

    it('批准与拒绝并发时只有先取得申请行锁的操作生效', async () => {
      let status = 'PENDING';
      let tail = Promise.resolve<unknown>(undefined);
      (prisma.$transaction as jest.Mock).mockImplementation((callback) => {
        const run = tail.then(() => callback(prisma));
        tail = run.catch(() => undefined);
        return run;
      });
      (prisma.leaseTerminationRequest.findUnique as jest.Mock).mockImplementation(async () => ({
        ...baseRequest,
        status,
      }));
      (prisma.lease.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        roomId: 2,
        status: 'ACTIVE',
        deposit: new Prisma.Decimal(1800),
      });
      (prisma.lease.update as jest.Mock).mockResolvedValue({ status: 'ENDED' });
      (prisma.leaseTerminationRequest.update as jest.Mock).mockImplementation(async ({ data }) => {
        status = data.status;
        return { ...baseRequest, ...data };
      });

      const results = await Promise.allSettled([
        service.approveTerminationRequest(7, {}, 1),
        service.rejectTerminationRequest(7, { note: '不同意' }, 1),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(status).toBe('APPROVED');
      expect(prisma.leaseTerminationRequest.update).toHaveBeenCalledTimes(1);
      expect(prisma.lease.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('approveTransferRequest', () => {
    const baseRequest = {
      id: 3,
      leaseId: 1,
      status: 'PENDING',
      lease: {
        deposit: new Prisma.Decimal(1800),
        payCycle: 'MONTHLY',
        tenant: { id: 10, name: '张三', phone: '13800000000', idCard: '310101199001011234' },
      },
    };

    it('目标房间非空置时拒绝', async () => {
      (prisma.roomTransferRequest.findUnique as jest.Mock).mockResolvedValue(baseRequest);
      (prisma.room.findUnique as jest.Mock).mockResolvedValue({ id: 5, status: 'RENTED', roomNo: '101' });
      await expect(
        service.approveTransferRequest(
          3,
          { targetRoomId: 5, newRent: 2000, newDeposit: 2000, newEndDate: '2027-01-01' },
          1,
        ),
      ).rejects.toThrow('目标房间不是空置状态');
    });

    it('租客缺身份证号且审批时也没补充时拒绝', async () => {
      (prisma.roomTransferRequest.findUnique as jest.Mock).mockResolvedValue({
        ...baseRequest,
        lease: { ...baseRequest.lease, tenant: { ...baseRequest.lease.tenant, idCard: null } },
      });
      (prisma.room.findUnique as jest.Mock).mockResolvedValue({ id: 5, status: 'VACANT', roomNo: '101' });
      await expect(
        service.approveTransferRequest(
          3,
          { targetRoomId: 5, newRent: 2000, newDeposit: 2000, newEndDate: '2027-01-01' },
          1,
        ),
      ).rejects.toThrow('身份证号');
    });

    it('成功路径:结束旧租约+创建新租约+自动发起电子签约', async () => {
      (prisma.roomTransferRequest.findUnique as jest.Mock).mockResolvedValue(baseRequest);
      (prisma.room.findUnique as jest.Mock).mockResolvedValue({ id: 5, status: 'VACANT', roomNo: '101' });
      (prisma.lease.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        roomId: 2,
        status: 'ACTIVE',
        deposit: new Prisma.Decimal(1800),
      });
      (prisma.lease.update as jest.Mock).mockResolvedValue({ status: 'ENDED' });
      (prisma.tenant.findFirst as jest.Mock).mockResolvedValue(baseRequest.lease.tenant);
      (prisma.lease.create as jest.Mock).mockResolvedValue({ id: 200 });
      (prisma.contractSigningTask.create as jest.Mock).mockResolvedValue({
        id: 300,
        status: 'PENDING_SCAN',
        sceneValue: 123,
        qrCodeImage: null,
      });
      (prisma.roomTransferRequest.update as jest.Mock).mockImplementation(({ data }) => ({ id: 3, ...data }));
      (prisma.contractSigningTask.update as jest.Mock).mockResolvedValue({});
      wechatQrcode.createSceneQrcode.mockResolvedValue({ ticket: 'ticket', qrCodeImage: 'qr' });

      const result = await service.approveTransferRequest(
        3,
        { targetRoomId: 5, newRent: 2000, newDeposit: 2000, newEndDate: '2027-01-01' },
        1,
      );

      expect(prisma.lease.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ roomId: 5, tenantId: 10, rent: 2000, deposit: 2000 }),
      });
      expect(prisma.contractSigningTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ leaseId: 200, type: 'NEW', status: 'PENDING_SCAN' }),
      });
      expect(result.newLeaseId).toBe(200);
      expect(result.status).toBe('APPROVED');
    });

    it('审批时补充的身份证号写回原租客并供新租约签约使用', async () => {
      const tenantWithoutIdCard = {
        ...baseRequest.lease.tenant,
        idCard: null,
        openid: null,
      };
      (prisma.roomTransferRequest.findUnique as jest.Mock).mockResolvedValue({
        ...baseRequest,
        lease: { ...baseRequest.lease, tenant: tenantWithoutIdCard },
      });
      (prisma.room.findUnique as jest.Mock).mockResolvedValue({
        id: 5,
        status: 'VACANT',
        roomNo: '101',
      });
      (prisma.lease.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        roomId: 2,
        status: 'ACTIVE',
        deposit: new Prisma.Decimal(1800),
      });
      (prisma.lease.update as jest.Mock).mockResolvedValue({ status: 'ENDED' });
      (prisma.tenant.findFirst as jest.Mock).mockResolvedValue(tenantWithoutIdCard);
      (prisma.tenant.update as jest.Mock).mockImplementation(({ data }) => ({
        ...tenantWithoutIdCard,
        ...data,
      }));
      (prisma.lease.create as jest.Mock).mockResolvedValue({ id: 200 });
      (prisma.contractSigningTask.create as jest.Mock).mockResolvedValue({
        id: 300,
        status: 'PENDING_SCAN',
        sceneValue: 123,
        qrCodeImage: null,
      });
      (prisma.roomTransferRequest.update as jest.Mock).mockResolvedValue({
        id: 3,
        status: 'APPROVED',
        newLeaseId: 200,
      });
      wechatQrcode.createSceneQrcode.mockResolvedValue({ ticket: 'ticket', qrCodeImage: 'qr' });
      (prisma.contractSigningTask.update as jest.Mock).mockResolvedValue({});

      await service.approveTransferRequest(
        3,
        {
          targetRoomId: 5,
          newRent: 2000,
          newDeposit: 2000,
          newEndDate: '2027-01-01',
          tenantIdCard: '310101199001011234',
        },
        1,
      );

      expect(prisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { idCard: '310101199001011234' },
      });
      expect(prisma.lease.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ tenantId: 10 }),
      });
    });

    it('事务提交后才调用二维码服务,外部失败不重建租约或签约任务', async () => {
      let transactionOpen = false;
      (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
        transactionOpen = true;
        try {
          return await callback(prisma);
        } finally {
          transactionOpen = false;
        }
      });
      (prisma.roomTransferRequest.findUnique as jest.Mock).mockResolvedValue(baseRequest);
      (prisma.room.findUnique as jest.Mock).mockResolvedValue({ id: 5, status: 'VACANT', roomNo: '101' });
      (prisma.lease.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        roomId: 2,
        status: 'ACTIVE',
        deposit: new Prisma.Decimal(1800),
      });
      (prisma.lease.update as jest.Mock).mockResolvedValue({ status: 'ENDED' });
      (prisma.tenant.findFirst as jest.Mock).mockResolvedValue(baseRequest.lease.tenant);
      (prisma.lease.create as jest.Mock).mockResolvedValue({ id: 200 });
      (prisma.contractSigningTask.create as jest.Mock).mockResolvedValue({
        id: 300,
        status: 'PENDING_SCAN',
        sceneValue: 123,
        qrCodeImage: null,
      });
      (prisma.roomTransferRequest.update as jest.Mock).mockResolvedValue({
        id: 3,
        status: 'APPROVED',
        newLeaseId: 200,
      });
      wechatQrcode.createSceneQrcode.mockImplementation(async () => {
        expect(transactionOpen).toBe(false);
        throw new Error('injected QR timeout');
      });

      await expect(
        service.approveTransferRequest(
          3,
          { targetRoomId: 5, newRent: 2000, newDeposit: 2000, newEndDate: '2027-01-01' },
          1,
        ),
      ).resolves.toEqual(expect.objectContaining({ status: 'APPROVED', newLeaseId: 200 }));
      expect(prisma.lease.create).toHaveBeenCalledTimes(1);
      expect(prisma.contractSigningTask.create).toHaveBeenCalledTimes(1);
    });

    it('新租约写入失败时不会创建签约任务或标记申请已批准', async () => {
      (prisma.roomTransferRequest.findUnique as jest.Mock).mockResolvedValue(baseRequest);
      (prisma.room.findUnique as jest.Mock).mockResolvedValue({ id: 5, status: 'VACANT', roomNo: '101' });
      (prisma.lease.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        roomId: 2,
        status: 'ACTIVE',
        deposit: new Prisma.Decimal(1800),
      });
      (prisma.lease.update as jest.Mock).mockResolvedValue({ status: 'ENDED' });
      (prisma.tenant.findFirst as jest.Mock).mockResolvedValue(baseRequest.lease.tenant);
      (prisma.lease.create as jest.Mock).mockRejectedValue(new Error('injected lease failure'));

      await expect(
        service.approveTransferRequest(
          3,
          { targetRoomId: 5, newRent: 2000, newDeposit: 2000, newEndDate: '2027-01-01' },
          1,
        ),
      ).rejects.toThrow('injected lease failure');
      expect(prisma.contractSigningTask.create).not.toHaveBeenCalled();
      expect(prisma.roomTransferRequest.update).not.toHaveBeenCalled();
      expect(wechatQrcode.createSceneQrcode).not.toHaveBeenCalled();
    });

    it('两个申请并发抢同一房间时只创建一份新租约', async () => {
      let tail = Promise.resolve<unknown>(undefined);
      let targetStatus = 'VACANT';
      (prisma.$transaction as jest.Mock).mockImplementation((callback) => {
        const run = tail.then(() => callback(prisma));
        tail = run.catch(() => undefined);
        return run;
      });
      (prisma.roomTransferRequest.findUnique as jest.Mock).mockImplementation(async ({ where }) => ({
        ...baseRequest,
        id: where.id,
        leaseId: where.id,
        lease: { ...baseRequest.lease, tenant: { ...baseRequest.lease.tenant, id: where.id + 10 } },
      }));
      (prisma.room.findUnique as jest.Mock).mockImplementation(async ({ where }) => ({
        id: where.id,
        status: targetStatus,
        roomNo: '101',
      }));
      (prisma.lease.findUnique as jest.Mock).mockImplementation(async ({ where }) => ({
        id: where.id,
        roomId: where.id + 20,
        status: 'ACTIVE',
        deposit: new Prisma.Decimal(1800),
      }));
      (prisma.room.update as jest.Mock).mockImplementation(async ({ where, data }) => {
        if (where.id === 5) targetStatus = data.status;
        return { id: where.id, ...data };
      });
      (prisma.lease.update as jest.Mock).mockResolvedValue({ status: 'ENDED' });
      (prisma.tenant.findFirst as jest.Mock).mockImplementation(async ({ where }) => ({
        id: where.phone === '13800000000' ? 10 : 11,
        idCard: '310101199001011234',
      }));
      (prisma.lease.create as jest.Mock).mockResolvedValue({ id: 200 });
      (prisma.contractSigningTask.create as jest.Mock).mockResolvedValue({
        id: 300,
        status: 'PENDING_SCAN',
        sceneValue: 123,
        qrCodeImage: null,
      });
      (prisma.roomTransferRequest.update as jest.Mock).mockResolvedValue({
        status: 'APPROVED',
        newLeaseId: 200,
      });
      wechatQrcode.createSceneQrcode.mockResolvedValue({ ticket: 'ticket', qrCodeImage: 'qr' });

      const dto = {
        targetRoomId: 5,
        newRent: 2000,
        newDeposit: 2000,
        newEndDate: '2027-01-01',
      };
      const results = await Promise.allSettled([
        service.approveTransferRequest(3, dto, 1),
        service.approveTransferRequest(4, dto, 1),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(prisma.lease.create).toHaveBeenCalledTimes(1);
      expect(prisma.contractSigningTask.create).toHaveBeenCalledTimes(1);
    });

    it('已处理过的申请不能重复审批', async () => {
      (prisma.roomTransferRequest.findUnique as jest.Mock).mockResolvedValue({
        ...baseRequest,
        status: 'REJECTED',
      });
      await expect(
        service.approveTransferRequest(
          3,
          { targetRoomId: 5, newRent: 2000, newDeposit: 2000, newEndDate: '2027-01-01' },
          1,
        ),
      ).rejects.toThrow('该申请已处理');
    });
  });
});
