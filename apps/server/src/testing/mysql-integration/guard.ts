import { execFileSync } from 'child_process';
import { constants as fsConstants, accessSync } from 'fs';
import { isAbsolute } from 'path';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Fail-closed opt-in guard for the REL-001 real-MySQL integration harness.
 * Every dimension below must explicitly match before any real network/DB
 * connection is attempted. Never log `process.env.DATABASE_URL` or any
 * derived credential — only the fixed, non-secret constants below.
 */
export const OPT_IN_ENV = 'REL001_MYSQL_INTEGRATION';
export const CANDIDATE_SHA_ENV = 'REL001_MYSQL_INTEGRATION_CANDIDATE_SHA';
export const DOCKER_EXECUTABLE_ENV = 'REL001_DOCKER_EXECUTABLE';

export const REQUIRED_HOST = '127.0.0.1';
export const REQUIRED_PORT = '33317';
export const REQUIRED_DATABASE = 'landlord_easy_e2e';
export const REQUIRED_DOCKER_PROJECT = 'landlordeasy_ops001';
export const REQUIRED_DOCKER_SERVICE = 'mysql';
export const REQUIRED_IMAGE_DIGEST =
  'mysql@sha256:7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b';

export interface MysqlIntegrationGuardResult {
  allowed: boolean;
  reason: string;
  /** Only present when allowed; callers must not print this value. */
  databaseUrl?: string;
}

function parseDatabaseUrl(
  raw: string,
): { host: string; port: string; database: string } | null {
  try {
    const url = new URL(raw);
    return {
      host: url.hostname,
      port: url.port,
      database: url.pathname.replace(/^\//, ''),
    };
  } catch {
    return null;
  }
}

function currentHeadSha(): string | null {
  try {
    return execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function trackedWorktreeIsClean(): boolean {
  const checks = [
    ['diff', '--quiet', '--'],
    ['diff', '--cached', '--quiet', '--'],
  ];
  try {
    for (const args of checks) {
      execFileSync('/usr/bin/git', args, {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
    }
    return true;
  } catch {
    return false;
  }
}

/** Never throws; always returns a reason so tests can skip with an explanation. */
export function evaluateMysqlIntegrationGuard(): MysqlIntegrationGuardResult {
  if (process.env[OPT_IN_ENV] !== '1') {
    return {
      allowed: false,
      reason: `${OPT_IN_ENV} is not set to "1" — this suite is opt-in and stays skipped by default`,
    };
  }

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    return { allowed: false, reason: 'DATABASE_URL is not set' };
  }
  const parsed = parseDatabaseUrl(rawUrl);
  if (!parsed) {
    return { allowed: false, reason: 'DATABASE_URL could not be parsed as a URL' };
  }
  if (
    parsed.host !== REQUIRED_HOST ||
    parsed.port !== REQUIRED_PORT ||
    parsed.database !== REQUIRED_DATABASE
  ) {
    return {
      allowed: false,
      reason: `DATABASE_URL must target ${REQUIRED_HOST}:${REQUIRED_PORT}/${REQUIRED_DATABASE} (host/port/database only; value itself is not logged)`,
    };
  }

  const expectedSha = process.env[CANDIDATE_SHA_ENV];
  if (!expectedSha) {
    return {
      allowed: false,
      reason: `${CANDIDATE_SHA_ENV} is not set`,
    };
  }
  if (!/^[0-9a-f]{40}$/.test(expectedSha)) {
    return {
      allowed: false,
      reason: `${CANDIDATE_SHA_ENV} must be exactly one lowercase 40-hex commit SHA`,
    };
  }
  const actualSha = currentHeadSha();
  if (!actualSha) {
    return { allowed: false, reason: 'unable to resolve worktree HEAD via git rev-parse' };
  }
  if (actualSha !== expectedSha) {
    return {
      allowed: false,
      reason: 'worktree HEAD does not match the supplied reviewed candidate',
    };
  }
  if (!trackedWorktreeIsClean()) {
    return {
      allowed: false,
      reason: 'worktree has staged or unstaged tracked changes',
    };
  }

  return { allowed: true, reason: 'all guard checks passed', databaseUrl: rawUrl };
}

function dockerOutput(executable: string, args: string[]): string {
  return execFileSync(executable, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/** Independently proves the accepted Docker boundary before fixtures can run. */
export function assertDockerIsolationGuard(): void {
  const executable = process.env[DOCKER_EXECUTABLE_ENV];
  if (!executable || !isAbsolute(executable)) {
    throw new Error(`${DOCKER_EXECUTABLE_ENV} must be an explicit absolute executable path`);
  }
  try {
    accessSync(executable, fsConstants.X_OK);
  } catch {
    throw new Error(`${DOCKER_EXECUTABLE_ENV} is not executable`);
  }

  const ids = dockerOutput(executable, [
    'ps',
    '-aq',
    '--filter',
    `label=com.docker.compose.project=${REQUIRED_DOCKER_PROJECT}`,
  ])
    .split(/\s+/)
    .filter(Boolean);
  if (ids.length !== 1) throw new Error('REL-001 Docker guard requires exactly one project container');
  const info = JSON.parse(dockerOutput(executable, ['inspect', ids[0]]))[0];
  const labels = info?.Config?.Labels ?? {};
  const bindings = info?.NetworkSettings?.Ports?.['3306/tcp'] ?? [];
  if (
    info?.Name !== '/landlordeasy_ops001-mysql-1' ||
    labels['com.docker.compose.project'] !== REQUIRED_DOCKER_PROJECT ||
    labels['com.docker.compose.service'] !== REQUIRED_DOCKER_SERVICE ||
    info?.State?.Status !== 'running' ||
    info?.State?.Health?.Status !== 'healthy' ||
    bindings.length !== 1 ||
    bindings[0]?.HostIp !== REQUIRED_HOST ||
    bindings[0]?.HostPort !== REQUIRED_PORT ||
    (info?.Mounts ?? []).length !== 0 ||
    !Object.prototype.hasOwnProperty.call(info?.HostConfig?.Tmpfs ?? {}, '/var/lib/mysql')
  ) {
    throw new Error('REL-001 Docker identity or isolation guard failed');
  }
  const networks = dockerOutput(executable, [
    'network',
    'ls',
    '-q',
    '--filter',
    `label=com.docker.compose.project=${REQUIRED_DOCKER_PROJECT}`,
  ])
    .split(/\s+/)
    .filter(Boolean);
  const volumes = dockerOutput(executable, [
    'volume',
    'ls',
    '-q',
    '--filter',
    `label=com.docker.compose.project=${REQUIRED_DOCKER_PROJECT}`,
  ])
    .split(/\s+/)
    .filter(Boolean);
  const image = JSON.parse(dockerOutput(executable, ['image', 'inspect', 'mysql:8.0']))[0];
  if (
    networks.length !== 1 ||
    volumes.length !== 0 ||
    !(image?.RepoDigests ?? []).includes(REQUIRED_IMAGE_DIGEST) ||
    info?.Image !== image?.Id
  ) {
    throw new Error('REL-001 Docker image, network, or volume guard failed');
  }
}

/** Requires an exactly empty schema so every row in the run is synthetic and attributable. */
export async function assertSyntheticDatabaseEmpty(client: PrismaClient): Promise<number> {
  const tables = await client.$queryRaw<Array<{ TABLE_NAME: string }>>(Prisma.sql`
    SELECT TABLE_NAME
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
    ORDER BY TABLE_NAME
  `);
  if (!tables.length) throw new Error('REL-001 database schema is absent');
  let total = 0;
  for (const { TABLE_NAME: table } of tables) {
    if (!/^[A-Za-z0-9_]+$/.test(table)) throw new Error('REL-001 database table identity is invalid');
    const rows = await client.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) AS count FROM \`${table}\``,
    );
    total += Number(rows[0]?.count ?? 0);
  }
  if (total !== 0) throw new Error('REL-001 database contains pre-existing rows');
  return tables.length;
}

/**
 * Registers a describe block that only actually executes its tests (and
 * their hooks) when every fail-closed guard passes. When any guard fails the
 * block is registered via `describe.skip`, so Jest reports it as skipped —
 * never as a failure — and the reason is visible in the block title without
 * ever printing DATABASE_URL or any credential.
 */
export function describeMysqlIntegration(name: string, fn: () => void): void {
  const guard = evaluateMysqlIntegrationGuard();
  const runner = guard.allowed ? describe : describe.skip;
  const title = guard.allowed ? `${name} [opted in]` : `${name} [skipped: ${guard.reason}]`;
  runner(title, fn);
}
