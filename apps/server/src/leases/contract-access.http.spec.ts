import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { AuthService } from '../auth/auth.service';
import { LandlordGuard } from '../auth/guards/landlord.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ResponseInterceptor } from '../common/interceptors/response.interceptor';
import { TenantApiController } from '../tenant-api/tenant-api.controller';
import { TenantApiService } from '../tenant-api/tenant-api.service';
import { LeasesController } from './leases.controller';
import { LeasesService } from './leases.service';
import * as contractStorage from './contract-storage';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { request } from 'http';
import { ServeStaticModule } from '@nestjs/serve-static';
import { blockContractUploads } from '../common/middleware/contract-uploads.middleware';

// Real HTTP routing, JWT verification, guards, service authorization and response
// interceptor; database/provider/storage fixtures do not contact live systems.
describe('SEC-001 authenticated contract HTTP boundary', () => {
  let app: INestApplication;
  let base: string;
  let temp: string;
  const actualRead = contractStorage.readContractPdf;
  const actualWrite = contractStorage.writeContractPdf;
  const pdf = Buffer.from('%PDF-1.4\nSEC-001\n\u0000\u00ff\n%%EOF');
  const prisma = {
    landlord: { findUnique: jest.fn() },
    tenant: { findUnique: jest.fn(), update: jest.fn() },
    contractSigningTask: {
      findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn(),
    },
  };
  const provider = { downloadSignedFile: jest.fn() };
  let read: jest.SpyInstance;
  let write: jest.SpyInstance;
  const token = (role: 'landlord' | 'tenant', tenantId = 7) => jwt.sign(
    { sub: role === 'landlord' ? 1 : tenantId, openid: 'http-test', role, tenantId },
    process.env.JWT_SECRET || 'dev-secret', { expiresIn: 60 },
  );
  const get = (url: string, bearer?: string) => fetch(`${base}${url.startsWith('/leases') || url.startsWith('/tenant') ? '/api/v1' : ''}${url}`, {
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
  });
  // Preserve raw dot/slash encodings rather than letting fetch normalize attack paths.
  const getRaw = (url: string) => new Promise<{ status: number; body: Buffer }>((resolve, reject) => {
    const parsed = new URL(base);
    const req = request({ hostname: parsed.hostname, port: parsed.port, path: url }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
  const task = (overrides: Record<string, unknown> = {}) => ({
    id: 42, leaseId: 9, status: 'SIGNED', signedAt: new Date('2026-09-01'),
    signedPdfUrl: '/uploads/contract-42-signed.pdf', weiqianBId: 'provider-42',
    lease: { id: 9, tenantId: 7, status: 'ENDED', tenant: { id: 7, isActive: true } },
    ...overrides,
  });
  beforeAll(async () => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-http-'));
    jest.spyOn(process, 'cwd').mockReturnValue(temp);
    actualWrite(42, 'signed', pdf);
    const uploads = path.join(temp, 'data/uploads');
    fs.mkdirSync(uploads);
    fs.writeFileSync(path.join(uploads, 'contract-42-signed.pdf'), pdf);
    fs.writeFileSync(path.join(uploads, 'repair.jpg'), 'safe-image');
    fs.mkdirSync(path.join(uploads, 'nested'));
    fs.writeFileSync(path.join(uploads, 'nested', 'contract-42-signed.pdf'), pdf);
    const privatePdf = path.join(temp, 'data/private/contracts/contract-42-signed.pdf');
    fs.writeFileSync(path.join(path.dirname(privatePdf), 'scan.jpg'), pdf);
    fs.symlinkSync(privatePdf, path.join(uploads, 'innocent.jpg'));
    fs.symlinkSync(privatePdf, path.join(uploads, '%72epair.jpg'));
    fs.symlinkSync(path.dirname(privatePdf), path.join(uploads, 'images'));
    // Use a separate private file so the genuine downloadable fixture stays single-linked.
    fs.writeFileSync(path.join(temp, 'secret.pdf'), pdf);
    fs.linkSync(path.join(temp, 'secret.pdf'), path.join(uploads, 'hardlinked.jpg'));
    const service = new LeasesService(prisma as any, {} as any, {} as any,
      provider as any, {} as any, {} as any);
    class FixtureModule {}
    Module({
      imports: [ServeStaticModule.forRoot({ rootPath: uploads, serveRoot: '/uploads' })],
      controllers: [LeasesController, TenantApiController],
      providers: [
        LandlordGuard, TenantGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: AuthService, useValue: new AuthService(prisma as any, {} as any) },
        { provide: LeasesService, useValue: service },
        { provide: TenantApiService, useValue: {} },
      ],
    })(FixtureModule);
    app = await NestFactory.create(FixtureModule, { logger: false });
    app.use(blockContractUploads);
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    read = jest.spyOn(contractStorage, 'readContractPdf');
    write = jest.spyOn(contractStorage, 'writeContractPdf');
  });
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.landlord.findUnique.mockResolvedValue({ id: 1, isActive: true });
    prisma.tenant.findUnique.mockResolvedValue({ id: 7, isActive: true });
    prisma.contractSigningTask.findUnique.mockResolvedValue(task());
    prisma.contractSigningTask.findMany.mockResolvedValue([]);
    provider.downloadSignedFile.mockResolvedValue(pdf);
    read.mockImplementation(actualRead);
    write.mockImplementation(actualWrite);
  });
  afterAll(async () => { jest.restoreAllMocks(); await app?.close(); fs.rmSync(temp, { recursive: true, force: true }); });

  it.each([
    ['/leases/contract-signing-tasks/42/pdf', undefined],
    ['/leases/contract-signing-tasks/42/preview', undefined],
    ['/tenant/contracts/42/pdf', undefined],
    ['/tenant/contracts', undefined],
    ['/tenant/contracts/42/pdf', 'invalid-token'],
  ])('rejects unauthenticated/invalid request %s before file/provider access', async (url, bearer) => {
    const response = await get(url, bearer);
    expect(response.status).toBe(401);
    expect(read).not.toHaveBeenCalled();
    expect(provider.downloadSignedFile).not.toHaveBeenCalled();
    expect(prisma.contractSigningTask.findUnique).not.toHaveBeenCalled();
  });
  it.each(['pdf', 'preview'])('tenant cannot use landlord %s route', async (kind) => {
    expect((await get(`/leases/contract-signing-tasks/42/${kind}`, token('tenant'))).status).toBe(401);
    expect(read).not.toHaveBeenCalled();
    expect(provider.downloadSignedFile).not.toHaveBeenCalled();
  });
  it('landlord cannot use tenant endpoint', async () => {
    expect((await get('/tenant/contracts/42/pdf', token('landlord'))).status).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });
  it('disabled landlord is revoked immediately', async () => {
    prisma.landlord.findUnique.mockResolvedValue({ id: 1, isActive: false });
    expect((await get('/leases/contract-signing-tasks/42/pdf', token('landlord'))).status).toBe(401);
    expect(read).not.toHaveBeenCalled();
    expect(provider.downloadSignedFile).not.toHaveBeenCalled();
  });
  it('cross-tenant access is denied before reading a signed PDF', async () => {
    const response = await get('/tenant/contracts/42/pdf', token('tenant', 8));
    expect([403, 404]).toContain(response.status);
    expect(read).not.toHaveBeenCalled();
    expect(provider.downloadSignedFile).not.toHaveBeenCalled();
  });
  it('unsigned task is not downloadable by tenant', async () => {
    prisma.contractSigningTask.findUnique.mockResolvedValue(task({ status: 'CREATED', signedAt: null }));
    expect([400, 403, 404]).toContain((await get('/tenant/contracts/42/pdf', token('tenant'))).status);
    expect(read).not.toHaveBeenCalled();
    expect(provider.downloadSignedFile).not.toHaveBeenCalled();
  });
  it('missing task does not access provider or storage', async () => {
    prisma.contractSigningTask.findUnique.mockResolvedValue(null);
    expect((await get('/tenant/contracts/999/pdf', token('tenant'))).status).toBe(404);
    expect(read).not.toHaveBeenCalled();
    expect(provider.downloadSignedFile).not.toHaveBeenCalled();
  });
  it.each([
    ['/leases/contract-signing-tasks/42/pdf', 'landlord'],
    ['/tenant/contracts/42/pdf', 'tenant'],
  ] as const)('returns private binary PDF including own historic lease: %s', async (url, role) => {
    const response = await get(url, token(role));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/pdf/);
    expect(response.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pdf);
    expect(provider.downloadSignedFile).not.toHaveBeenCalled();
  });
  it('preview returns binary without confirming or changing signing state', async () => {
    prisma.contractSigningTask.findUnique.mockResolvedValue(task({ status: 'CREATED', signedAt: null }));
    const response = await get('/leases/contract-signing-tasks/42/preview', token('landlord'));
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pdf);
    expect(prisma.contractSigningTask.update).not.toHaveBeenCalled();
    expect(prisma.contractSigningTask.updateMany).not.toHaveBeenCalled();
    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });
  it('rejects path traversal as a task identifier', async () => {
    expect((await get('/tenant/contracts/%2e%2e%2fsecret/pdf', token('tenant'))).status).toBe(400);
    expect(read).not.toHaveBeenCalled();
    expect(provider.downloadSignedFile).not.toHaveBeenCalled();
  });
  it('missing private archive fails closed without provider fallback', async () => {
    prisma.contractSigningTask.findUnique.mockResolvedValue(task({ id: 999 }));
    expect((await get('/tenant/contracts/999/pdf', token('tenant'))).status).toBe(404);
    expect(provider.downloadSignedFile).not.toHaveBeenCalled();
  });
  it('tenant discovery is scoped to signed contracts of authenticated tenant', async () => {
    expect((await get('/tenant/contracts', token('tenant'))).status).toBe(200);
    expect(prisma.contractSigningTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'SIGNED', lease: { tenantId: 7 } },
    }));
  });
  it.each([
    '/uploads/contract-42-signed.pdf', '/uploads/CONTRACT-42-SIGNED.PDF',
    '/uploads/%63ontract-42-signed.pdf', '/uploads/%2563ontract-42-signed.pdf',
    '/%75ploads/%63ontract-42-signed.pdf', '/uploads%2fcontract-42-signed.pdf',
    '/uploads//contract-42-signed.pdf', '/uploads/./contract-42-signed.pdf',
    '/uploads/nested/../contract-42-signed.pdf', '/uploads/nested/contract-42-signed.pdf',
    '/uploads/nested%2fcontract-42-signed.pdf', '/uploads/nested%2f..%2fcontract-42-signed.pdf',
    '/uploads/%2e%2e%2fprivate/contracts/contract-42-signed.pdf',
    '/uploads/contract-42-signed.pdf?token=ignored', '/private/contracts/contract-42-signed.pdf',
  ])('blocks legacy public URL with old PDF still present: %s', async (url) => {
    const response = await getRaw(url);
    expect(response.status).toBe(404);
    expect(response.body).not.toEqual(pdf);
  });
  it.each([
    '/uploads/innocent.jpg', '/uploads//innocent.jpg', '/uploads/%69nnocent.jpg',
    '/uploads/images/scan.jpg', '/uploads/hardlinked.jpg', '/uploads/%2572epair.jpg',
  ])
  ('denies filesystem aliases even when upload names look harmless: %s', async (url) => {
    const response = await getRaw(url);
    expect(response.status).toBe(404);
    expect(response.body).not.toEqual(pdf);
  });
  it('retains legitimate maintenance image static serving', async () => {
    const response = await get('/uploads/repair.jpg');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('safe-image');
  });

});
