import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LeasesService } from './leases.service';
import { PrismaService } from '../prisma/prisma.service';
import { IWechatQrcodeService } from '../wechat/wechat-qrcode.interface';

describe('LeasesService contract signing tasks', () => {
  let service: LeasesService;
  let prisma: jest.Mocked<PrismaService>;
  let wechatQrcode: jest.Mocked<IWechatQrcodeService>;

  const dto = {
    type: 'NEW' as const,
    waterMeterReading: 12.5,
    electricityMeterReading: 34.5,
    gasMeterReading: 6.5,
    facilities: [{ name: '空调', has: true }],
  };

  beforeEach(() => {
    prisma = {
      lease: { findUnique: jest.fn() },
      contractSigningTask: {
        create: jest.fn(),
        update: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;
    wechatQrcode = {
      createSceneQrcode: jest.fn(),
    };
    service = new LeasesService(prisma, wechatQrcode);
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
    (prisma.lease.findUnique as jest.Mock).mockResolvedValue({ id: 1 });
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
        gasMeterReading: 6.5,
        facilities: [{ name: '空调', has: true }],
        status: 'PENDING_SCAN',
      },
    });
    const sceneValue = (prisma.contractSigningTask.create as jest.Mock).mock
      .calls[0][0].data.sceneValue;
    expect(sceneValue).toBeGreaterThan(0);
    expect(sceneValue).toBeLessThanOrEqual(2 ** 31 - 1);
    expect(wechatQrcode.createSceneQrcode).toHaveBeenCalledWith(123456);
    expect(prisma.contractSigningTask.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { qrCodeImage: completedTask.qrCodeImage },
    });
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
      leaseId: 1,
      type: 'RENEW',
      sceneValue: 654321,
      status: 'PENDING_SCAN',
      qrCodeImage: null,
    };
    const completedTask = {
      ...createdTask,
      qrCodeImage: 'data:image/png;base64,retried-qrcode',
    };
    (prisma.lease.findUnique as jest.Mock).mockResolvedValue({ id: 1 });
    (prisma.contractSigningTask.create as jest.Mock)
      .mockRejectedValueOnce(uniqueConstraintError)
      .mockResolvedValueOnce(createdTask);
    wechatQrcode.createSceneQrcode.mockResolvedValue({
      ticket: 'ticket-2',
      qrCodeImage: completedTask.qrCodeImage,
    });
    (prisma.contractSigningTask.update as jest.Mock).mockResolvedValue(completedTask);

    await expect(
      service.createContractSigningTask(1, { type: 'RENEW' }),
    ).resolves.toEqual(completedTask);
    expect(prisma.contractSigningTask.create).toHaveBeenCalledTimes(2);
    expect(wechatQrcode.createSceneQrcode).toHaveBeenCalledWith(654321);
  });
});
