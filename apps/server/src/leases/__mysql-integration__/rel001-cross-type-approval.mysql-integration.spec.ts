import { PrismaClient } from '@prisma/client';
import { LeasesService } from '../leases.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  assertDockerIsolationGuard,
  assertSyntheticDatabaseEmpty,
  describeMysqlIntegration,
  evaluateMysqlIntegrationGuard,
} from '../../testing/mysql-integration/guard';
import { createRealPrismaClient } from '../../testing/mysql-integration/real-client';
import { createTransferFixture } from '../../testing/mysql-integration/fixtures';
import {
  createFakeContractPdf,
  createFakeWechatCustomerService,
  createFakeWechatNotify,
  createFakeWechatQrcode,
  createFakeWeiqian,
} from '../../testing/mysql-integration/fakes';

/**
 * REL-001 real-MySQL evidence for the CROSS-TYPE concurrent approval path.
 *
 * A lease can carry a PENDING termination request and a PENDING transfer
 * request at the same time. Those are different rows, so they take different
 * row locks, and both approvals reach `endLeaseInTransaction` for the same
 * lease. Under REPEATABLE READ the old read-then-branch ACTIVE guard could
 * observe a stale snapshot and let both proceed, ending one lease twice and
 * writing duplicate deposit records.
 *
 * The existing REL-001 suites only cover same-request-id duplicates and two
 * transfers competing for one room, which is why 11/11 passed without
 * surfacing this. Stays skipped unless REL001_MYSQL_INTEGRATION=1 and every
 * guard in `guard.ts` passes.
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

describeMysqlIntegration('REL-001 real MySQL: concurrent cross-type approval', () => {
  let databaseUrl: string;

  beforeAll(async () => {
    const guard = evaluateMysqlIntegrationGuard();
    if (!guard.allowed || !guard.databaseUrl) {
      throw new Error('guarded describe block executed without a passing guard');
    }
    databaseUrl = guard.databaseUrl;
    assertDockerIsolationGuard();
    const client = createRealPrismaClient(databaseUrl);
    try {
      await assertSyntheticDatabaseEmpty(client);
    } finally {
      await client.$disconnect();
    }
  });

  it('a termination approval and a transfer approval racing on one lease end it exactly once', async () => {
    const fixtureClient = createRealPrismaClient(databaseUrl);
    const fixture = await createTransferFixture(fixtureClient, {
      oldDeposit: 3000,
      oldRent: 1500,
    });

    // The transfer fixture does not record the deposit receipt that a real
    // lease would have, and the settlement assertions below depend on it.
    await fixtureClient.depositRecord.create({
      data: {
        leaseId: fixture.oldLeaseId,
        type: 'RECEIVE',
        amount: 3000,
        operatorId: fixture.landlordId,
      },
    });

    // The fixture supplies the PENDING transfer request; add a PENDING
    // termination request on the same lease so both paths are live at once.
    const termination = await fixtureClient.leaseTerminationRequest.create({
      data: {
        leaseId: fixture.oldLeaseId,
        tenantId: fixture.tenantId,
        requestedMoveOutDate: new Date(),
        status: 'PENDING',
        suggestedPenalty: 1000,
      },
    });

    const connectionA = createRealPrismaClient(databaseUrl);
    const connectionB = createRealPrismaClient(databaseUrl);
    const serviceA = buildService(connectionA);
    const serviceB = buildService(connectionB);

    const outcomes = await Promise.allSettled([
      serviceA.approveTerminationRequest(
        termination.id,
        { finalPenalty: 1000 },
        fixture.landlordId,
      ),
      serviceB.approveTransferRequest(
        fixture.requestId,
        {
          targetRoomId: fixture.targetRoomId,
          newRent: 1500,
          newDeposit: 3000,
          newEndDate: new Date(Date.now() + 365 * 24 * 3600 * 1000)
            .toISOString()
            .split('T')[0],
        },
        fixture.landlordId,
      ),
    ]);

    const fulfilled = outcomes.filter((item) => item.status === 'fulfilled');
    const rejected = outcomes.filter(
      (item): item is PromiseRejectedResult => item.status === 'rejected',
    );

    // Exactly one approval may win. This is the invariant the atomic claim in
    // endLeaseInTransaction exists to guarantee.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason?.message ?? rejected[0].reason)).toContain('租约已结束');

    const endedLease = await fixtureClient.lease.findUniqueOrThrow({
      where: { id: fixture.oldLeaseId },
    });
    expect(endedLease.status).toBe('ENDED');

    // The loser's whole transaction must have rolled back: no duplicate
    // settlement rows may exist for the lease that was ended once.
    const settlement = await fixtureClient.depositRecord.findMany({
      where: { leaseId: fixture.oldLeaseId, type: { in: ['REFUND', 'DEDUCT'] } },
    });
    const byType = settlement.map((record) => record.type);
    expect(new Set(byType).size).toBe(byType.length);

    // And the original deposit receipt is untouched.
    const receipts = await fixtureClient.depositRecord.findMany({
      where: { leaseId: fixture.oldLeaseId, type: 'RECEIVE' },
    });
    expect(receipts).toHaveLength(1);

    // A new lease exists only if the transfer was the winner; never both.
    const transferRequest = await fixtureClient.roomTransferRequest.findUniqueOrThrow({
      where: { id: fixture.requestId },
    });
    const terminationRequest = await fixtureClient.leaseTerminationRequest.findUniqueOrThrow({
      where: { id: termination.id },
    });
    const approvals = [transferRequest.status, terminationRequest.status].filter(
      (status) => status === 'APPROVED',
    );
    expect(approvals).toHaveLength(1);
    if (transferRequest.status !== 'APPROVED') {
      expect(transferRequest.newLeaseId).toBeNull();
    }

    await connectionA.$disconnect();
    await connectionB.$disconnect();
    // The transfer fixture does not know about the termination request we
    // added, so remove it before its own cleanup deletes the lease.
    await fixtureClient.leaseTerminationRequest.deleteMany({
      where: { leaseId: fixture.oldLeaseId },
    });
    await fixture.cleanup();
    await fixtureClient.$disconnect();
  });
});
