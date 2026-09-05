import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

// Deliberately independent from signedPdfUrl: legacy DB strings are never paths or URLs to fetch.
function directory(create: boolean): string {
  let current = process.cwd();
  for (const part of ['data', 'private', 'contracts']) {
    current = path.join(current, part);
    if (create && !fs.existsSync(current)) fs.mkdirSync(current, { mode: 0o700 });
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Unsafe contract directory');
  }
  return current;
}
function filename(id: number, kind: 'signed' | 'preview'): string {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid contract ID');
  return `contract-${id}-${kind}.pdf`;
}
export function writeContractPdf(id: number, kind: 'signed' | 'preview', content: Buffer): void {
  const root = directory(true);
  const target = path.join(root, filename(id, kind));
  const temp = path.join(root, `.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, content, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, target);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
export function readContractPdf(id: number): Buffer {
  const target = path.join(directory(false), filename(id, 'signed'));
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('Unsafe contract file');
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
