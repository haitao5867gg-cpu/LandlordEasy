import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readContractPdf, writeContractPdf } from './contract-storage';

describe('private contract storage filesystem boundary', () => {
  let root: string;
  let cwd: jest.SpyInstance;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-storage-'));
    cwd = jest.spyOn(process, 'cwd').mockReturnValue(root);
  });
  afterEach(() => { cwd.mockRestore(); fs.rmSync(root, { recursive: true, force: true }); });

  it('archives in private storage and rejects non-positive / unsafe IDs', () => {
    writeContractPdf(42, 'signed', Buffer.from('%PDF-private'));
    expect(readContractPdf(42).toString()).toBe('%PDF-private');
    expect(fs.existsSync(path.join(root, 'data/uploads'))).toBe(false);
    expect(() => readContractPdf(-1)).toThrow();
    expect(() => writeContractPdf(Number.MAX_SAFE_INTEGER + 1, 'signed', Buffer.from('x'))).toThrow();
  });

  it('refuses symlinked parent directories without writing outside storage', () => {
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    fs.mkdirSync(path.join(root, 'data'));
    fs.symlinkSync(outside, path.join(root, 'data/private'));
    expect(() => writeContractPdf(42, 'signed', Buffer.from('x'))).toThrow();
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('refuses signed symlinks and hardlinks; replacement never mutates their targets', () => {
    writeContractPdf(42, 'signed', Buffer.from('original'));
    const target = path.join(root, 'data/private/contracts/contract-42-signed.pdf');
    const outside = path.join(root, 'outside.pdf');
    fs.writeFileSync(outside, 'outside');
    fs.unlinkSync(target);
    fs.symlinkSync(outside, target);
    expect(() => readContractPdf(42)).toThrow();
    writeContractPdf(42, 'signed', Buffer.from('replacement'));
    expect(fs.readFileSync(outside, 'utf8')).toBe('outside');
    fs.unlinkSync(target);
    fs.linkSync(outside, target);
    expect(() => readContractPdf(42)).toThrow();
  });
});
