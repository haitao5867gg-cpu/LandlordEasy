import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Test-only wrapper around a real PrismaClient connected to the isolated
 * MySQL integration database. It never mocks Prisma behavior: every read and
 * write still goes to the real database. It only observes and, on request,
 * interrupts interactive `$transaction` callbacks so failure-injection tests
 * can discover the real write sequence a service produces and recreate it.
 */

export const INJECTED_FAILURE_MARKER = 'REL001_MYSQL_INTEGRATION_INJECTED_FAILURE';

const MUTATION_METHODS = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

export interface MutationEvent {
  model: string;
  method: string;
  /** 1-based position of this mutation within the current transaction attempt. */
  index: number;
}

interface MutationControls {
  failAfter: number | null;
  mutationCount: number;
  log: MutationEvent[];
}

export interface MutationCountingHandle {
  /** Pass this in place of PrismaService when constructing the service under test. */
  client: PrismaClient;
  /**
   * Configure the next transaction(s) to throw right after the Nth successful
   * mutation completes (1-based). Pass null to let transactions run to
   * completion uninterrupted (used for the discovery pass).
   */
  configureFailAfter(failAfter: number | null): void;
  /** Successful mutations observed since the last configureFailAfter call. */
  getMutationLog(): MutationEvent[];
  disconnect(): Promise<void>;
}

function wrapModelDelegate(
  modelName: string,
  delegate: Record<string, unknown>,
  controls: MutationControls,
): Record<string, unknown> {
  return new Proxy(delegate, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string' || typeof value !== 'function') return value;
      const fn = value as (...args: unknown[]) => Promise<unknown>;
      if (!MUTATION_METHODS.has(prop)) return fn.bind(target);
      return async (...args: unknown[]) => {
        const result = await fn.apply(target, args);
        controls.mutationCount += 1;
        controls.log.push({ model: modelName, method: prop, index: controls.mutationCount });
        if (controls.failAfter !== null && controls.mutationCount === controls.failAfter) {
          throw new Error(
            `${INJECTED_FAILURE_MARKER}: after mutation #${controls.mutationCount} (${modelName}.${prop})`,
          );
        }
        return result;
      };
    },
  });
}

function wrapTransactionClient(
  tx: Prisma.TransactionClient,
  controls: MutationControls,
): Prisma.TransactionClient {
  return new Proxy(tx, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop === 'symbol') return value;
      if (typeof value === 'function') return (value as (...a: unknown[]) => unknown).bind(target);
      if (
        value &&
        typeof value === 'object' &&
        typeof (value as { create?: unknown }).create === 'function'
      ) {
        return wrapModelDelegate(prop, value as Record<string, unknown>, controls);
      }
      return value;
    },
  }) as Prisma.TransactionClient;
}

export function createMutationCountingPrismaClient(databaseUrl: string): MutationCountingHandle {
  const real = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const controls: MutationControls = { failAfter: null, mutationCount: 0, log: [] };

  const proxy = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === '$transaction') {
        return (arg: unknown, options?: unknown) => {
          const boundTransaction = (target.$transaction as (...a: unknown[]) => unknown).bind(
            target,
          );
          if (typeof arg === 'function') {
            const callback = arg as (tx: Prisma.TransactionClient) => unknown;
            return boundTransaction(
              (tx: Prisma.TransactionClient) => callback(wrapTransactionClient(tx, controls)),
              options,
            );
          }
          return boundTransaction(arg, options);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  }) as PrismaClient;

  return {
    client: proxy,
    configureFailAfter(failAfter: number | null) {
      controls.failAfter = failAfter;
      controls.mutationCount = 0;
      controls.log = [];
    },
    getMutationLog() {
      return [...controls.log];
    },
    async disconnect() {
      await real.$disconnect();
    },
  };
}
