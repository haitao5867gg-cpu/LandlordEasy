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
import { createTerminationFixture, TerminationFixture } from '../../testing/mysql-integration/fixtures';
import { normalizeForSnapshot } from '../../testing/mysql-integration/snapshot';
import {
  createFakeContractPdf,
  createFakeWechatCustomerService,
  createFakeWechatNotify,
  createFakeWechatQrcode,
  createFakeWeiqian,
} from '../../testing/mysql-integration/fakes';

/**
 * REL-001 real-MySQL integration evidence for approveTerminationRequest.
 * Stays skipped unless REL001_MYSQL_INTEGRATION=1 and every guard in
 * `guard.ts` (loopback host, fixed port, dedicated database, exact candidate
 * SHA) passes. See src/testing/mysql-integration/README.md for how to run.
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

async function captureSnapshot(client: PrismaClient, fixture: TerminationFixture) {
  const [lease, room, depositRecords, bills, request] = await Promise.all([
    client.lease.findUnique({ where: { id: fixture.leaseId } }),
    client.room.findUnique({ where: { id: fixture.roomId } }),
    client.depositRecord.findMany({ where: { leaseId: fixture.leaseId }, orderBy: { id: 'asc' } }),
    client.bill.findMany({
      where: { leaseId: fixture.leaseId },
      include: { items: true },
      orderBy: { id: 'asc' },
    }),
    client.leaseTerminationRequest.findUnique({ where: { id: fixture.requestId } }),
  ]);
  return normalizeForSnapshot({ lease, room, depositRecords, bills, request });
}

describeMysqlIntegration('REL-001 real MySQL: termination approval', () => {
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

  describe.each([
    { label: 'within-deposit path (no shortfall bill)', deposit: 3000, rent: 1500, suggestedPenalty: 1000, finalPenalty: 1000 },
    { label: 'shortfall path (ad-hoc bill created)', deposit: 1000, rent: 1500, suggestedPenalty: 1500, finalPenalty: 1500 },
  ])('$label', ({ deposit, rent, suggestedPenalty, finalPenalty }) => {
    it('commits the full write sequence exactly once on the happy path, then rolls back completely for every intermediate injected failure', async () => {
      counting.configureFailAfter(null);
      const discoveryFixture = await createTerminationFixture(fixtureClient, {
        deposit,
        rent,
        suggestedPenalty,
      });
      const discoveryService = buildService(counting.client);

      const approved = await discoveryService.approveTerminationRequest(
        discoveryFixture.requestId,
        { finalPenalty },
        discoveryFixture.landlordId,
      );
      expect(approved.status).toBe('APPROVED');

      const totalMutations = counting.getMutationLog().length;
      expect(totalMutations).toBeGreaterThan(1);

      const finalLease = await fixtureClient.lease.findUnique({ where: { id: discoveryFixture.leaseId } });
      expect(finalLease?.status).toBe('ENDED');
      const finalRoom = await fixtureClient.room.findUnique({ where: { id: discoveryFixture.roomId } });
      expect(finalRoom?.status).toBe('VACANT');
      await discoveryFixture.cleanup();

      for (let failAfter = 1; failAfter <= totalMutations; failAfter += 1) {
        const fixture = await createTerminationFixture(fixtureClient, { deposit, rent, suggestedPenalty });
        const before = await captureSnapshot(fixtureClient, fixture);

        counting.configureFailAfter(failAfter);
        const service = buildService(counting.client);
        await expect(
          service.approveTerminationRequest(fixture.requestId, { finalPenalty }, fixture.landlordId),
        ).rejects.toThrow(INJECTED_FAILURE_MARKER);

        const after = await captureSnapshot(fixtureClient, fixture);
        expect(after).toStrictEqual(before);
        expect(after.request).toMatchObject({ status: 'PENDING' });
        expect(after.lease).toMatchObject({ status: 'ACTIVE' });

        await fixture.cleanup();
      }
    });
  });

  it('duplicate approval returns the already-approved result without a second settlement', async () => {
    counting.configureFailAfter(null);
    const fixture = await createTerminationFixture(fixtureClient, {
      deposit: 3000,
      rent: 1500,
      suggestedPenalty: 1000,
    });
    const service = buildService(fixtureClient);

    const first = await service.approveTerminationRequest(
      fixture.requestId,
      { finalPenalty: 1000 },
      fixture.landlordId,
    );
    const depositRecordsAfterFirst = await fixtureClient.depositRecord.findMany({
      where: { leaseId: fixture.leaseId },
    });

    const second = await service.approveTerminationRequest(
      fixture.requestId,
      { finalPenalty: 1000 },
      fixture.landlordId,
    );
    const depositRecordsAfterSecond = await fixtureClient.depositRecord.findMany({
      where: { leaseId: fixture.leaseId },
    });

    expect(second.id).toBe(first.id);
    expect(second.status).toBe('APPROVED');
    expect(depositRecordsAfterSecond).toHaveLength(depositRecordsAfterFirst.length);

    await fixture.cleanup();
  });

  it('concurrent approve vs reject on separate connections produces exactly one terminal state', async () => {
    const fixture = await createTerminationFixture(fixtureClient, {
      deposit: 3000,
      rent: 1500,
      suggestedPenalty: 1000,
    });
    const connectionA = createRealPrismaClient(databaseUrl);
    const connectionB = createRealPrismaClient(databaseUrl);
    const serviceA = buildService(connectionA);
    const serviceB = buildService(connectionB);

    try {
      const [approveResult, rejectResult] = await Promise.allSettled([
        serviceA.approveTerminationRequest(fixture.requestId, { finalPenalty: 1000 }, fixture.landlordId),
        serviceB.rejectTerminationRequest(fixture.requestId, { note: 'reject race' }, fixture.landlordId),
      ]);

      const fulfilled = [approveResult, rejectResult].filter((r) => r.status === 'fulfilled');
      const rejected = [approveResult, rejectResult].filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);

      const finalRequest = await fixtureClient.leaseTerminationRequest.findUnique({
        where: { id: fixture.requestId },
      });
      const finalLease = await fixtureClient.lease.findUnique({ where: { id: fixture.leaseId } });

      if (approveResult.status === 'fulfilled') {
        expect(finalRequest?.status).toBe('APPROVED');
        expect(finalLease?.status).toBe('ENDED');
      } else {
        expect(finalRequest?.status).toBe('REJECTED');
        expect(finalLease?.status).toBe('ACTIVE');
      }
    } finally {
      await connectionA.$disconnect();
      await connectionB.$disconnect();
    }

    await fixture.cleanup();
  });
});
