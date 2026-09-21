import { PrismaClient } from '@prisma/client';

/** A real, unwrapped PrismaClient bound to the guarded integration database URL. */
export function createRealPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}
