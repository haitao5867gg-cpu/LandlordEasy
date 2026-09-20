import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { MaintenanceService } from '../maintenance.service';
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
import { createRepairFixture, RepairFixture } from '../../testing/mysql-integration/fixtures';
import { normalizeForSnapshot } from '../../testing/mysql-integration/snapshot';

/**
 * REL-001 real-MySQL integration evidence for repair completion
 * (updateRepairRequest RESOLVED + positive-cost maintenance record).
 * Stays skipped unless REL001_MYSQL_INTEGRATION=1 and every guard in
 * `guard.ts` passes. See src/testing/mysql-integration/README.md.
 */

function buildService(client: PrismaClient): MaintenanceService {
  return new MaintenanceService(client as unknown as PrismaService);
}

async function captureSnapshot(client: PrismaClient, fixture: RepairFixture) {
  const [repairRequest, maintenanceRecords] = await Promise.all([
    client.repairRequest.findUnique({ where: { id: fixture.repairRequestId } }),
    client.maintenanceRecord.findMany({ where: { roomId: fixture.roomId }, orderBy: { id: 'asc' } }),
  ]);
  return normalizeForSnapshot({ repairRequest, maintenanceRecords });
}

describeMysqlIntegration('REL-001 real MySQL: repair completion', () => {
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

  it('commits the resolved status plus positive-cost maintenance record exactly once, then rolls back completely for every intermediate injected failure', async () => {
    counting.configureFailAfter(null);
    const discoveryFixture = await createRepairFixture(fixtureClient);
    const discoveryService = buildService(counting.client);

    const resolved = await discoveryService.updateRepairRequest(
      discoveryFixture.repairRequestId,
      { status: 'RESOLVED', resolvedCost: 200 },
      discoveryFixture.landlordId,
    );
    expect(resolved.status).toBe('RESOLVED');

    const totalMutations = counting.getMutationLog().length;
    expect(totalMutations).toBe(2); // repairRequest.update + maintenanceRecord.create

    const maintenanceRecords = await fixtureClient.maintenanceRecord.findMany({
      where: { roomId: discoveryFixture.roomId },
    });
    expect(maintenanceRecords).toHaveLength(1);
    expect(Number(maintenanceRecords[0].cost)).toBe(200);
    await discoveryFixture.cleanup();

    for (let failAfter = 1; failAfter <= totalMutations; failAfter += 1) {
      const fixture = await createRepairFixture(fixtureClient);
      const before = await captureSnapshot(fixtureClient, fixture);

      counting.configureFailAfter(failAfter);
      const service = buildService(counting.client);
      await expect(
        service.updateRepairRequest(
          fixture.repairRequestId,
          { status: 'RESOLVED', resolvedCost: 200 },
          fixture.landlordId,
        ),
      ).rejects.toThrow(INJECTED_FAILURE_MARKER);

      const after = await captureSnapshot(fixtureClient, fixture);
      expect(after).toStrictEqual(before);
      expect(after.repairRequest).toMatchObject({ status: 'IN_PROGRESS' });
      expect(after.maintenanceRecords).toHaveLength(0);

      await fixture.cleanup();
    }
  });

  it('duplicate concurrent completion on separate connections creates exactly one maintenance record', async () => {
    const fixture = await createRepairFixture(fixtureClient);
    const connectionA = createRealPrismaClient(databaseUrl);
    const connectionB = createRealPrismaClient(databaseUrl);
    const serviceA = buildService(connectionA);
    const serviceB = buildService(connectionB);

    try {
      const results = await Promise.allSettled([
        serviceA.updateRepairRequest(
          fixture.repairRequestId,
          { status: 'RESOLVED', resolvedCost: 200 },
          fixture.landlordId,
        ),
        serviceB.updateRepairRequest(
          fixture.repairRequestId,
          { status: 'RESOLVED', resolvedCost: 200 },
          fixture.landlordId,
        ),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);

      const maintenanceRecords = await fixtureClient.maintenanceRecord.findMany({
        where: { roomId: fixture.roomId },
      });
      expect(maintenanceRecords).toHaveLength(1);

      const finalRequest = await fixtureClient.repairRequest.findUnique({
        where: { id: fixture.repairRequestId },
      });
      expect(finalRequest?.status).toBe('RESOLVED');
    } finally {
      await connectionA.$disconnect();
      await connectionB.$disconnect();
    }

    await fixture.cleanup();
  });
});
