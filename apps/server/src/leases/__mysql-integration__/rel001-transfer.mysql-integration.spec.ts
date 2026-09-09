import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { LeasesService } from '../leases.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  assertDockerIsolationGuard,
  assertSyntheticDatabaseEmpty,
  describeMysqlIntegration,
  evaluateMysqlIntegrationGuard,
} from '../../testing/mysql-integration/guard';
import {
  createMutationCountingPrismaClient,
  INJECTED_FAILURE_MARKER,
  MutationCountingHandle,
} from '../../testing/mysql-integration/mutation-counting-client';
import { createRealPrismaClient } from '../../testing/mysql-integration/real-client';
import {
  createCompetingOldLease,
  createTransferFixture,
  TransferFixture,
} from '../../testing/mysql-integration/fixtures';
import { normalizeForSnapshot } from '../../testing/mysql-integration/snapshot';
import {
  createFakeContractPdf,
  createFakeWechatCustomerService,
  createFakeWechatNotify,
  createFakeWechatQrcode,
  createFakeWeiqian,
} from '../../testing/mysql-integration/fakes';

/**
 * REL-001 real-MySQL integration evidence for approveTransferRequest.
 * Stays skipped unless REL001_MYSQL_INTEGRATION=1 and every guard in
 * `guard.ts` passes. See src/testing/mysql-integration/README.md.
 */

function buildService(client: PrismaClient): LeasesService {
  return new LeasesService(
    client as unknown as PrismaService,
    createFakeWechatQrcode(),
    createFakeContractPdf(),
    createFakeWeiqian(),
    createFakeWechatCustomerService(),
    createFakeWechatNotify(),
  );
}

async function captureSnapshot(client: PrismaClient, fixture: TransferFixture) {
  const [oldLease, oldRoom, targetRoom, request, tenant, leaseCount, signingTaskCount, depositRecords] =
    await Promise.all([
      client.lease.findUnique({ where: { id: fixture.oldLeaseId } }),
      client.room.findUnique({ where: { id: fixture.oldRoomId } }),
      client.room.findUnique({ where: { id: fixture.targetRoomId } }),
      client.roomTransferRequest.findUnique({ where: { id: fixture.requestId } }),
      client.tenant.findUnique({ where: { id: fixture.tenantId } }),
      client.lease.count({ where: { tenantId: fixture.tenantId } }),
      client.contractSigningTask.count({ where: { lease: { tenantId: fixture.tenantId } } }),
      client.depositRecord.findMany({ where: { leaseId: fixture.oldLeaseId }, orderBy: { id: 'asc' } }),
    ]);
  return normalizeForSnapshot({
    oldLease,
    oldRoom,
    targetRoom,
    request,
    tenant,
    leaseCount,
    signingTaskCount,
    depositRecords,
  });
}

describeMysqlIntegration('REL-001 real MySQL: transfer approval', () => {
  let fixtureClient: PrismaClient;
  let counting: MutationCountingHandle;
  let databaseUrl: string;

  beforeAll(async () => {
    const guard = evaluateMysqlIntegrationGuard();
    if (!guard.allowed || !guard.databaseUrl) {
      throw new Error('guarded describe block executed without a passing guard');
    }
    databaseUrl = guard.databaseUrl;
    assertDockerIsolationGuard();
    fixtureClient = createRealPrismaClient(databaseUrl);
    await assertSyntheticDatabaseEmpty(fixtureClient);
    counting = createMutationCountingPrismaClient(databaseUrl);
  });

  afterAll(async () => {
    if (fixtureClient) await fixtureClient.$disconnect();
    if (counting) await counting.disconnect();
  });

  it('commits the full cross-lease write sequence exactly once on the happy path, then rolls back every intermediate injected failure leaving old state unchanged and no new artifacts', async () => {
    counting.configureFailAfter(null);
    const discoveryFixture = await createTransferFixture(fixtureClient, { oldDeposit: 2000, oldRent: 1600 });
    const discoveryService = buildService(counting.client);

    const approved = await discoveryService.approveTransferRequest(
      discoveryFixture.requestId,
      { targetRoomId: discoveryFixture.targetRoomId, newRent: 1800, newDeposit: 1800, newEndDate: '2030-01-01' },
      discoveryFixture.landlordId,
    );
    expect(approved.status).toBe('APPROVED');
    expect(approved.newLeaseId).toBeTruthy();

    const totalMutations = counting.getMutationLog().length;
    expect(totalMutations).toBeGreaterThan(1);

    const oldLease = await fixtureClient.lease.findUnique({ where: { id: discoveryFixture.oldLeaseId } });
    expect(oldLease?.status).toBe('ENDED');
    const targetRoom = await fixtureClient.room.findUnique({ where: { id: discoveryFixture.targetRoomId } });
    expect(targetRoom?.status).toBe('RENTED');
    const newLease = await fixtureClient.lease.findUnique({ where: { id: approved.newLeaseId! } });
    expect(newLease).toMatchObject({ tenantId: discoveryFixture.tenantId, status: 'ACTIVE' });
    const signingTask = await fixtureClient.contractSigningTask.findFirst({
      where: { leaseId: approved.newLeaseId! },
    });
    expect(signingTask).toMatchObject({ status: 'PENDING_SCAN' });
    expect(signingTask?.qrCodeImage).toBeTruthy();
    await discoveryFixture.cleanup();

    for (let failAfter = 1; failAfter <= totalMutations; failAfter += 1) {
      const fixture = await createTransferFixture(fixtureClient, { oldDeposit: 2000, oldRent: 1600 });
      const before = await captureSnapshot(fixtureClient, fixture);

      counting.configureFailAfter(failAfter);
      const service = buildService(counting.client);
      await expect(
        service.approveTransferRequest(
          fixture.requestId,
          { targetRoomId: fixture.targetRoomId, newRent: 1800, newDeposit: 1800, newEndDate: '2030-01-01' },
          fixture.landlordId,
        ),
      ).rejects.toThrow(INJECTED_FAILURE_MARKER);

      const after = await captureSnapshot(fixtureClient, fixture);
      expect(after).toStrictEqual(before);
      expect(after.request).toMatchObject({ status: 'PENDING', newLeaseId: null });
      expect(after.oldLease).toMatchObject({ status: 'ACTIVE' });
      expect(after.leaseCount).toBe(1);
      expect(after.signingTaskCount).toBe(0);

      await fixture.cleanup();
    }
  });

  it('duplicate approval returns the persisted new lease without creating a second one', async () => {
    const fixture = await createTransferFixture(fixtureClient, { oldDeposit: 2000, oldRent: 1600 });
    const service = buildService(fixtureClient);
    const dto = {
      targetRoomId: fixture.targetRoomId,
      newRent: 1800,
      newDeposit: 1800,
      newEndDate: '2030-01-01',
    };

    const first = await service.approveTransferRequest(fixture.requestId, dto, fixture.landlordId);
    const second = await service.approveTransferRequest(fixture.requestId, dto, fixture.landlordId);

    expect(second.newLeaseId).toBe(first.newLeaseId);
    const leaseCount = await fixtureClient.lease.count({ where: { tenantId: fixture.tenantId } });
    const signingTaskCount = await fixtureClient.contractSigningTask.count({
      where: { lease: { tenantId: fixture.tenantId } },
    });
    expect(leaseCount).toBe(2);
    expect(signingTaskCount).toBe(1);

    await fixture.cleanup();
  });

  it('two competing applicants for the same vacant room on separate connections: exactly one wins', async () => {
    const fixture = await createTransferFixture(fixtureClient, { oldDeposit: 2000, oldRent: 1600 });
    const competitor = await createCompetingOldLease(fixtureClient, { id: fixture.buildingId }, {
      oldDeposit: 2200,
      oldRent: 1700,
    });
    const connectionA = createRealPrismaClient(databaseUrl);
    const connectionB = createRealPrismaClient(databaseUrl);
    const serviceA = buildService(connectionA);
    const serviceB = buildService(connectionB);
    const dtoFor = (targetRoomId: number) => ({
      targetRoomId,
      newRent: 1800,
      newDeposit: 1800,
      newEndDate: '2030-01-01',
    });

    try {
      const [resultA, resultB] = await Promise.allSettled([
        serviceA.approveTransferRequest(fixture.requestId, dtoFor(fixture.targetRoomId), fixture.landlordId),
        serviceB.approveTransferRequest(competitor.requestId, dtoFor(fixture.targetRoomId), fixture.landlordId),
      ]);

      const fulfilled = [resultA, resultB].filter((r) => r.status === 'fulfilled');
      const rejected = [resultA, resultB].filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);

      const targetRoom = await fixtureClient.room.findUnique({ where: { id: fixture.targetRoomId } });
      expect(targetRoom?.status).toBe('RENTED');

      const winnerTenantId = resultA.status === 'fulfilled' ? fixture.tenantId : competitor.tenantId;
      const loserTenantId = resultA.status === 'fulfilled' ? competitor.tenantId : fixture.tenantId;
      const winnerLeaseCount = await fixtureClient.lease.count({ where: { tenantId: winnerTenantId } });
      const loserLeaseCount = await fixtureClient.lease.count({ where: { tenantId: loserTenantId } });
      expect(winnerLeaseCount).toBe(2);
      expect(loserLeaseCount).toBe(1);
    } finally {
      await connectionA.$disconnect();
      await connectionB.$disconnect();
    }

    await competitor.cleanup();
    await fixture.cleanup();
  });
});
