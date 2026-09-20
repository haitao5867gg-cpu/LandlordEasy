import { test, expect, type Page, type Download } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const token = 'sec001-synthetic-session';
const pdf = Buffer.from('%PDF-1.4\n% SEC-001 synthetic binary fixture\n%%EOF\n');
const lease = {
  id: 7, status: 'ENDED', startDate: '2025-01-01', endDate: '2025-12-31',
  rent: 2000, deposit: 2000, tenant: { name: '测试租客', phone: '00000000000', openid: 'fixture' },
  room: { building: { name: '测试楼' }, roomNo: '101' }, bills: [],
};
async function login(page: Page, role: string) {
  await page.addInitScript(({ role, token }) => {
    localStorage.setItem(`${role}_token`, token);
    localStorage.setItem('tenant_bound', '1');
  }, { role, token });
}
async function downloaded(download: Download, name: string) {
  expect(download.suggestedFilename()).toBe(name);
  expect(download.url()).toMatch(/^blob:/);
  expect(await readFile((await download.path())!)).toEqual(pdf);
}
async function capture(page: Page, name: string) {
  await expect(page.locator('.van-toast')).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
}
for (const status of ['CREATED', 'SIGNED']) {
  test(`landlord ${status}: authenticated binary, loading, duplicate prevention, recovery`, async ({ page }) => {
    await login(page, 'landlord');
    let reads = 0;
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const endpoint = `/api/v1/leases/contract-signing-tasks/42/${status === 'CREATED' ? 'preview' : 'pdf'}`;
    await page.route('**/api/v1/**', async route => {
      const req = route.request();
      const url = new URL(req.url());
      expect(req.headers().authorization).toBe(`Bearer ${token}`);
      expect(req.url()).not.toContain(token);
      if (url.pathname === endpoint) expect(url.search).toBe('');
      expect(req.method()).toBe('GET'); // preview never confirms or mutates signing
      if (url.pathname === endpoint) {
        reads++;
        if (reads === 1) {
          await pending;
          return route.fulfill({ status: 503, json: { message: 'fixture unavailable' } });
        }
        return route.fulfill({ contentType: 'application/pdf', body: pdf });
      }
      if (url.pathname === '/api/v1/leases/7') return route.fulfill({ json: { ...lease, contractSigningTasks: [{ id: 42, status, createdAt: '2026-09-05T00:00:00Z', signedAt: status === 'SIGNED' ? '2026-09-05T01:00:00Z' : null }] } });
      if (url.pathname === '/api/v1/handover' || url.pathname === '/api/v1/properties') return route.fulfill({ json: [] });
      throw new Error(`Unexpected fixture request ${req.url()}`);
    });
    await page.goto('http://127.0.0.1:5183/leases/7');
    const button = page.getByRole('button', { name: status === 'CREATED' ? '下载查看签署进度' : '查看/下载合同', exact: true });
    await button.click();
    const loading = page.locator('button.van-button--loading');
    await expect(loading).toHaveCount(1);
    await loading.evaluate(el => { (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click(); });
    expect(reads).toBe(1);
    release();
    await expect(page.getByText(status === 'CREATED' ? '签署进度下载失败，请稍后重试' : '合同下载失败，请稍后重试')).toBeVisible();
    await expect(button).toBeVisible();
    const download = page.waitForEvent('download');
    await button.click();
    await downloaded(await download, `contract-42-${status === 'CREATED' ? 'preview' : 'signed'}.pdf`);
    expect(reads).toBe(2);
    await expect(page.getByText(status === 'CREATED' ? '等待租客签署' : '已签署', { exact: true })).toBeVisible();
    await capture(page, `landlord-${status.toLowerCase()}`);
  });
}

test('tenant historic contract: list/download failure, retry, auth and duplicate prevention', async ({ page }) => {
  await login(page, 'tenant');
  let lists = 0, reads = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/**', async route => {
    const req = route.request(), url = new URL(req.url());
    expect(req.headers().authorization).toBe(`Bearer ${token}`);
    expect(url.search).toBe('');
    expect(req.method()).toBe('GET');
    if (url.pathname === '/api/v1/tenant/leases') return route.fulfill({ json: [lease] });
    if (url.pathname === '/api/v1/tenant/contracts') {
      if (++lists === 1) return route.fulfill({ status: 503, json: { message: 'fixture list failure' } });
      return route.fulfill({ json: [{ id: 42, leaseId: 7, status: 'SIGNED', signedAt: '2025-01-01T00:00:00Z' }] });
    }
    if (url.pathname === '/api/v1/tenant/contracts/42/pdf') {
      if (++reads === 1) { await pending; return route.fulfill({ status: 403, json: { message: 'fixture access failure' } }); }
      return route.fulfill({ contentType: 'application/pdf', body: pdf });
    }
    throw new Error(`Unexpected fixture request ${req.url()}`);
  });
  await page.goto('http://127.0.0.1:5184/tenant/leases');
  await expect(page.getByText('合同列表加载失败')).toBeVisible();
  await page.getByText('重试', { exact: true }).click();
  await expect(page.getByText('已退租', { exact: true })).toBeVisible();
  await expect(page.getByText('测试楼 101 租赁合同')).toBeVisible();
  const button = page.getByRole('button', { name: '下载合同', exact: true });
  await button.click();
  const loading = page.locator('button.van-button--loading');
  await expect(loading).toHaveCount(1);
  await loading.evaluate(el => { (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click(); });
  expect(reads).toBe(1);
  release();
  await expect(page.getByText('合同下载失败，请稍后重试')).toBeVisible();
  const download = page.waitForEvent('download');
  await button.click();
  await downloaded(await download, 'contract-42-signed.pdf');
  expect(reads).toBe(2);
  await capture(page, 'tenant-historical-contract');
});

test('tenant empty contracts and lease list', async ({ page }) => {
  await login(page, 'tenant');
  await page.route('**/api/v1/**', route => route.fulfill({ json: [] }));
  await page.goto('http://127.0.0.1:5184/tenant/leases');
  await expect(page.getByText('暂无租约', { exact: true })).toBeVisible();
  await expect(page.getByText('暂无已签署合同', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '下载合同' })).toHaveCount(0);
  await capture(page, 'tenant-empty');
});

test('tenant rejects non-PDF success response and can retry', async ({ page }) => {
  await login(page, 'tenant');
  let reads = 0, downloads = 0;
  page.on('download', () => downloads++);
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/pdf')) {
      reads++;
      return route.fulfill(reads === 1 ? { contentType: 'text/html', body: '<html>not a contract</html>' } : { contentType: 'application/pdf', body: pdf });
    }
    return route.fulfill({ json: path.endsWith('/leases') ? [lease] : [{ id: 42, leaseId: 7, status: 'SIGNED', signedAt: null }] });
  });
  await page.goto('http://127.0.0.1:5184/tenant/leases');
  const button = page.getByRole('button', { name: '下载合同', exact: true });
  await button.click();
  await expect(page.getByText('合同下载失败，请稍后重试')).toBeVisible();
  expect(downloads).toBe(0);
  const download = page.waitForEvent('download');
  await button.click();
  await downloaded(await download, 'contract-42-signed.pdf');
});
