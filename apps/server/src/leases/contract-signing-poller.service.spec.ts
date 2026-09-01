import { ContractSigningPollerService } from './contract-signing-poller.service';
import { LeasesService } from './leases.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ContractSigningPollerService', () => {
  it('查询全部 CREATED 任务并逐一触发签署确认', async () => {
    const prisma = {
      contractSigningTask: {
        findMany: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      },
    } as unknown as jest.Mocked<PrismaService>;
    const leasesService = {
      tryConfirmSigned: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<LeasesService>;
    const poller = new ContractSigningPollerService(prisma, leasesService);

    await poller.pollCreatedTasks();

    expect(prisma.contractSigningTask.findMany).toHaveBeenCalledWith({
      where: { status: 'CREATED' },
      select: { id: true },
    });
    expect(leasesService.tryConfirmSigned).toHaveBeenNthCalledWith(1, 1);
    expect(leasesService.tryConfirmSigned).toHaveBeenNthCalledWith(2, 2);
  });
});
