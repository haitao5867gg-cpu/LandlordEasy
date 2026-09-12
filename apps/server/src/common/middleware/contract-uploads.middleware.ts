import { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';

/** Static serving follows symlinks by default; aliases must not expose private PDFs. */
function unsafeUploadPath(pathname: string): boolean {
  const match = /^\/uploads(?:\/|$)(.*)/i.exec(pathname);
  if (!match) return false;
  let current = process.cwd();
  for (const part of ['data', 'uploads', ...match[1].split('/').filter(Boolean)]) {
    if (part === '..') return true;
    if (part === '.') continue;
    current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1)) return true;
    } catch {
      // Missing or unreadable paths do not need static middleware to inspect them.
      return true;
    }
  }
  return false;
}

/** Runs before static serving; repeated decoding also denies double-encoded legacy URLs. */
export function blockContractUploads(req: Request, res: Response, next: NextFunction): void {
  let pathname = req.originalUrl.split('?')[0];
  let staticPathname: string;
  try {
    // Express static decodes once. Keep that exact filesystem candidate separate
    // from repeated decoding used only for conservative legacy-name denial.
    staticPathname = decodeURIComponent(pathname);
    for (let i = 0; i < 8; i++) {
      const decoded = decodeURIComponent(pathname);
      if (decoded === pathname) break;
      pathname = decoded;
    }
  } catch {
    res.status(404).end();
    return;
  }
  pathname = pathname.replace(/\\/g, '/');
  if ((/\/(?:uploads|private)(?:\/|$)/i.test(pathname) &&
      (/(?:^|\/)contract-/i.test(pathname) || /\/private(?:\/|$)/i.test(pathname) || /(?:^|\/)\.\.(?:\/|$)/.test(pathname))) ||
      unsafeUploadPath(staticPathname)) {
    res.set('Cache-Control', 'no-store').status(404).end();
    return;
  }
  next();
}
