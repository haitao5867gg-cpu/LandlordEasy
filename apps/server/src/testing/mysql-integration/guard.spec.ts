import { execFileSync } from 'child_process';
import {
  CANDIDATE_SHA_ENV,
  evaluateMysqlIntegrationGuard,
  OPT_IN_ENV,
} from './guard';

jest.mock('child_process', () => ({ execFileSync: jest.fn() }));

const mockedExecFileSync = execFileSync as jest.MockedFunction<typeof execFileSync>;
const HEAD_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('REL-001 MySQL integration exact-head guard', () => {
  const originalOptIn = process.env[OPT_IN_ENV];
  const originalCandidate = process.env[CANDIDATE_SHA_ENV];
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env[OPT_IN_ENV] = '1';
    process.env.DATABASE_URL =
      'mysql://synthetic:synthetic@127.0.0.1:33317/landlord_easy_e2e';
    process.env[CANDIDATE_SHA_ENV] = HEAD_SHA;
    mockedExecFileSync.mockImplementation((executable, args) => {
      expect(executable).toBe('/usr/bin/git');
      const argv = args as string[];
      if (argv[0] === 'rev-parse') return `${HEAD_SHA}\n`;
      if (argv[0] === 'diff') return Buffer.alloc(0);
      throw new Error('unexpected git invocation');
    });
  });

  afterAll(() => {
    restoreEnvironment(OPT_IN_ENV, originalOptIn);
    restoreEnvironment(CANDIDATE_SHA_ENV, originalCandidate);
    restoreEnvironment('DATABASE_URL', originalDatabaseUrl);
  });

  it('rejects a missing candidate SHA before invoking git', () => {
    delete process.env[CANDIDATE_SHA_ENV];

    expect(evaluateMysqlIntegrationGuard()).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('is not set'),
    });
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed', 'abc123'],
    ['uppercase', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
  ])('rejects a %s candidate SHA before invoking git', (_label, value) => {
    process.env[CANDIDATE_SHA_ENV] = value;

    expect(evaluateMysqlIntegrationGuard()).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('lowercase 40-hex'),
    });
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it('rejects a well-formed but wrong candidate SHA when HEAD differs', () => {
    process.env[CANDIDATE_SHA_ENV] = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    expect(evaluateMysqlIntegrationGuard()).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('does not match'),
    });
  });

  it.each([
    ['unstaged', false],
    ['staged', true],
  ])('rejects %s tracked changes without requesting untracked paths', (_label, staged) => {
    mockedExecFileSync.mockImplementation((_executable, args) => {
      const argv = args as string[];
      if (argv[0] === 'rev-parse') return `${HEAD_SHA}\n`;
      if (argv[0] === 'diff') {
        const isStagedCheck = argv.includes('--cached');
        expect(argv).not.toContain('--untracked-files');
        if (isStagedCheck === staged) throw new Error('tracked changes detected');
        return Buffer.alloc(0);
      }
      throw new Error('unexpected git invocation');
    });

    expect(evaluateMysqlIntegrationGuard()).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('tracked changes'),
    });
  });

  it('allows a clean worktree whose HEAD exactly matches the supplied candidate', () => {
    expect(evaluateMysqlIntegrationGuard()).toMatchObject({
      allowed: true,
      reason: 'all guard checks passed',
    });
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      '/usr/bin/git',
      ['diff', '--quiet', '--'],
      expect.objectContaining({ stdio: ['ignore', 'ignore', 'ignore'] }),
    );
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      '/usr/bin/git',
      ['diff', '--cached', '--quiet', '--'],
      expect.objectContaining({ stdio: ['ignore', 'ignore', 'ignore'] }),
    );
  });
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
