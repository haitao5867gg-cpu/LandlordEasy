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

  beforeEach(() => {
    prisma = {
      lease: { findUnique: jest.fn() },
      room: { findUnique: jest.fn() },
      contractSigningTask: { findFirst: jest.fn() },
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
    } as unknown as jest.Mocked<PrismaService>;

    const wechatQrcode: jest.Mocked<IWechatQrcodeService> = {
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
      const endLeaseSpy = jest.spyOn(service, 'endLease').mockResolvedValue({} as never);
      (prisma.leaseTerminationRequest.update as jest.Mock).mockImplementation(({ data }) => data);

      const result = await service.approveTerminationRequest(7, {}, 1);

      expect(endLeaseSpy).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ depositRefund: 0 }),
        1,
      );
      expect(prisma.bill.create).not.toHaveBeenCalled();
      expect(result.finalPenalty).toBe(1800);
    });

    it('违约金超过押金时押金全扣+生成补差账单', async () => {
      (prisma.leaseTerminationRequest.findUnique as jest.Mock).mockResolvedValue(baseRequest);
      jest.spyOn(service, 'endLease').mockResolvedValue({} as never);
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

    it('已处理过的申请不能重复审批', async () => {
      (prisma.leaseTerminationRequest.findUnique as jest.Mock).mockResolvedValue({
        ...baseRequest,
        status: 'APPROVED',
      });
      await expect(service.approveTerminationRequest(7, {}, 1)).rejects.toThrow(
        '该申请已处理',
      );
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
      const endLeaseSpy = jest.spyOn(service, 'endLease').mockResolvedValue({} as never);
      const createSpy = jest.spyOn(service, 'create').mockResolvedValue({ id: 200 } as never);
      const signSpy = jest
        .spyOn(service, 'createContractSigningTask')
        .mockResolvedValue({} as never);
      (prisma.roomTransferRequest.update as jest.Mock).mockImplementation(({ data }) => data);

      const result = await service.approveTransferRequest(
        3,
        { targetRoomId: 5, newRent: 2000, newDeposit: 2000, newEndDate: '2027-01-01' },
        1,
      );

      expect(endLeaseSpy).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ endReason: '换租至101', depositRefund: 1800 }),
        1,
      );
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ roomId: 5, tenantPhone: '13800000000', rent: 2000, deposit: 2000 }),
        1,
      );
      expect(signSpy).toHaveBeenCalledWith(200, { type: 'NEW' });
      expect(result.newLeaseId).toBe(200);
      expect(result.status).toBe('APPROVED');
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
