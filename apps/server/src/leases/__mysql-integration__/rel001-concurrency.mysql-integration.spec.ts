import { Prisma, PrismaClient } from '@prisma/client';
import { LeasesService } from '../leases.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  assertDockerIsolationGuard,
  assertSyntheticDatabaseEmpty,
  describeMysqlIntegration,
  evaluateMysqlIntegrationGuard,
} from '../../testing/mysql-integration/guard';
import { createRealPrismaClient } from '../../testing/mysql-integration/real-client';
import { createRoomPairFixture, createTerminationFixture } from '../../testing/mysql-integration/fixtures';
import {
  createFakeContractPdf,
  createFakeWechatCustomerService,
  createFakeWechatNotify,
  createFakeWechatQrcode,
  createFakeWeiqian,
} from '../../testing/mysql-integration/fakes';

/**
 * REL-001 real-MySQL evidence that row locking genuinely serializes
 * concurrent writers across separate connections, and that a real,
 * deterministic MySQL deadlock is detected and recoverable with a bounded
 * manual retry that requires no production code change.
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

async function withBoundedRetry<T>(attempts: number, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

describeMysqlIntegration('REL-001 real MySQL: row locking and deadlock recovery', () => {
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

  it('a second connection genuinely waits on the row lock held by the first before proceeding', async () => {
    const fixtureClient = createRealPrismaClient(databaseUrl);
    const fixture = await createTerminationFixture(fixtureClient, {
      deposit: 3000,
      rent: 1500,
      suggestedPenalty: 1000,
    });
    const connectionA = createRealPrismaClient(databaseUrl);
    const connectionB = createRealPrismaClient(databaseUrl);
    const serviceB = buildService(connectionB);
    const holdMs = 700;

    let lockAcquired!: () => void;
    const lockAcquiredPromise = new Promise<void>((resolve) => {
      lockAcquired = resolve;
    });

    const holdingTransaction = connectionA.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM \`lease_termination_requests\` WHERE id = ${fixture.requestId} FOR UPDATE`,
      );
      lockAcquired();
      await new Promise((resolve) => setTimeout(resolve, holdMs));
    });

    await lockAcquiredPromise;
    const start = Date.now();
    const approved = await serviceB.approveTerminationRequest(
      fixture.requestId,
      { finalPenalty: 1000 },
      fixture.landlordId,
    );
    const elapsed = Date.now() - start;
    await holdingTransaction;

    expect(approved.status).toBe('APPROVED');
    expect(elapsed).toBeGreaterThanOrEqual(holdMs - 50);

    await connectionA.$disconnect();
    await connectionB.$disconnect();
    await fixture.cleanup();
    await fixtureClient.$disconnect();
  });

  it('two connections locking two rooms in reverse order produce a deterministic isolated deadlock, and a bounded manual retry recovers', async () => {
    const fixtureClient = createRealPrismaClient(databaseUrl);
    const pair = await createRoomPairFixture(fixtureClient);
    const connectionA = createRealPrismaClient(databaseUrl);
    const connectionB = createRealPrismaClient(databaseUrl);

    let aLocked!: () => void;
    const aLockedPromise = new Promise<void>((resolve) => {
      aLocked = resolve;
    });
    let bLocked!: () => void;
    const bLockedPromise = new Promise<void>((resolve) => {
      bLocked = resolve;
    });

    const attemptA = connectionA.$transaction(
      async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM \`rooms\` WHERE id = ${pair.roomAId} FOR UPDATE`);
        aLocked();
        await bLockedPromise;
        await tx.$queryRaw(Prisma.sql`SELECT id FROM \`rooms\` WHERE id = ${pair.roomBId} FOR UPDATE`);
        return 'A';
      },
      { timeout: 10000 },
    );
    const attemptB = connectionB.$transaction(
      async (tx) => {
        await aLockedPromise;
        await tx.$queryRaw(Prisma.sql`SELECT id FROM \`rooms\` WHERE id = ${pair.roomBId} FOR UPDATE`);
        bLocked();
        await tx.$queryRaw(Prisma.sql`SELECT id FROM \`rooms\` WHERE id = ${pair.roomAId} FOR UPDATE`);
        return 'B';
      },
      { timeout: 10000 },
    );

    const results = await Promise.allSettled([attemptA, attemptB]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const rejectedReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(String((rejectedReason as Error)?.message ?? rejectedReason).toLowerCase()).toMatch(/deadlock/);

    const retryResult = await withBoundedRetry(3, () =>
      connectionA.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM \`rooms\` WHERE id = ${pair.roomAId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM \`rooms\` WHERE id = ${pair.roomBId} FOR UPDATE`);
        return true;
      }),
    );
    expect(retryResult).toBe(true);

    await connectionA.$disconnect();
    await connectionB.$disconnect();
    await pair.cleanup();
    await fixtureClient.$disconnect();
  });
});
