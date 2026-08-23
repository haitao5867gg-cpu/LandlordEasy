import { expect, test, type Page, type Response } from '@playwright/test';

const landlordBaseUrl = 'http://127.0.0.1:5173';
const tenantBaseUrl = 'http://127.0.0.1:5174/tenant';
const apiPrefix = '/api/v1';
const runId = Date.now().toString().slice(-8);
const tenantName = `E2E租客${runId}`;
const tenantPhone = `139${runId}`;
const tenantOpenid = `e2e_tenant_${runId}`;
const rent = 1357;

let inviteCode = '';
let createdLeaseId = 0;

function waitForApi(
  page: Page,
  method: string,
  pathname: string | RegExp,
  query?: Record<string, string>,
): Promise<Response> {
  return page.waitForResponse((response) => {
    const request = response.request();
    const url = new URL(response.url());
    const pathMatches =
      typeof pathname === 'string'
        ? url.pathname === `${apiPrefix}${pathname}`
        : pathname.test(url.pathname);
    const queryMatches = Object.entries(query ?? {}).every(
      ([key, value]) => url.searchParams.get(key) === value,
    );
    return request.method() === method && pathMatches && queryMatches;
  });
}

async function expectApiSuccess<T = unknown>(response: Response): Promise<T> {
  expect(response.ok(), `${response.request().method()} ${response.url()}`).toBeTruthy();
  const body = (await response.json()) as { code: number; data: T };
  expect(body.code).toBe(0);
  return body.data;
}

function fieldInput(page: Page, label: string) {
  return page.locator('.van-field').filter({ hasText: label }).locator('input').first();
}

test.describe.serial('核心收租流程', () => {
  test('landlord-h5: 登录、工作台、新签、账单和待确认收款页', async ({ page }) => {
    await page.goto(`${landlordBaseUrl}/login`);

    // Vant 注册回归哨兵：未 app.use(Vant) 时这些 class 不会生成。
    await expect(page.locator('.van-cell-group')).toBeVisible();
    await expect(page.locator('.van-field')).toBeVisible();

    const loginPromise = waitForApi(page, 'POST', '/auth/landlord/login');
    const dashboardPromises = [
      waitForApi(page, 'GET', '/dashboard/vacancy'),
      waitForApi(page, 'GET', '/dashboard/expiring'),
      waitForApi(page, 'GET', '/dashboard/overdue'),
      waitForApi(page, 'GET', '/payments/pending'),
    ];
    await page.getByPlaceholder('输入 mock_openid').fill('mock_landlord_001');
    await page.getByRole('button', { name: '登录', exact: true }).click();

    await expectApiSuccess(await loginPromise);
    for (const response of await Promise.all(dashboardPromises)) {
      await expectApiSuccess(response);
    }
    await expect(page).toHaveURL(`${landlordBaseUrl}/`);
    await expect(page.locator('.van-tabbar')).toBeVisible();

    const dashboardCards = page.locator('.dashboard-cards .van-cell');
    await expect(dashboardCards).toHaveCount(4);
    for (const title of ['空置房间', '30天内到期', '逾期账单', '待确认收款']) {
      await expect(dashboardCards.filter({ hasText: title })).toBeVisible();
    }

    const buildingsPromise = waitForApi(page, 'GET', '/buildings');
    const roomsPromise = waitForApi(page, 'GET', '/rooms');
    await page.locator('.van-tabbar-item').filter({ hasText: '房间' }).click();
    await expectApiSuccess(await buildingsPromise);
    await expectApiSuccess(await roomsPromise);

    await page.getByText('全部状态', { exact: true }).click();
    const vacantRoomsPromise = waitForApi(page, 'GET', '/rooms', { status: 'VACANT' });
    await page
      .locator('.van-dropdown-item .van-cell')
      .filter({ hasText: '空置' })
      .click();
    const vacantRooms = await expectApiSuccess<unknown[]>(await vacantRoomsPromise);
    expect(vacantRooms.length).toBeGreaterThan(0);

    const roomDetailPromise = waitForApi(page, 'GET', /\/api\/v1\/rooms\/\d+$/);
    const firstVacantRoom = page
      .locator('.room-list-page > .van-cell-group .van-cell')
      .filter({ hasText: '空置' })
      .first();
    await expect(firstVacantRoom).toBeVisible();
    await firstVacantRoom.click();
    await expectApiSuccess(await roomDetailPromise);

    await page.getByRole('button', { name: '新签租约' }).click();
    await expect(page.locator('.van-form')).toBeVisible();
    await fieldInput(page, '姓名').fill(tenantName);
    await fieldInput(page, '手机号').fill(tenantPhone);
    await fieldInput(page, '月租金').fill(String(rent));
    await fieldInput(page, '押金').fill(String(rent));

    const createLeasePromise = waitForApi(page, 'POST', '/leases');
    await page.getByRole('button', { name: '确认签约' }).click();
    const lease = await expectApiSuccess<{ id: number; inviteCode: string }>(
      await createLeasePromise,
    );
    createdLeaseId = lease.id;
    inviteCode = lease.inviteCode;
    expect(createdLeaseId).toBeGreaterThan(0);
    expect(inviteCode).toMatch(/^[A-Z0-9]{8}$/);

    const successDialog = page.locator('.van-dialog').filter({ hasText: '签约成功' });
    await expect(successDialog).toBeVisible();
    await expect(successDialog.locator('h2')).toHaveText(inviteCode);
    await successDialog.getByRole('button', { name: '完成' }).click();
    await expect(successDialog).not.toBeVisible();

    // 新签接口不直接出账，使用现有本地调试接口运行真实账单引擎。
    const token = await page.evaluate(() => localStorage.getItem('landlord_token'));
    expect(token).toBeTruthy();
    const generateResponse = await page.request.post(
      'http://127.0.0.1:3000/api/v1/bills/generate',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(generateResponse.ok()).toBeTruthy();
    expect((await generateResponse.json()).code).toBe(0);

    const billsPromise = waitForApi(page, 'GET', '/bills');
    await page.locator('.van-tabbar-item').filter({ hasText: '账单' }).click();
    const bills = await expectApiSuccess<Array<{ leaseId: number }>>(await billsPromise);
    expect(bills.some((bill) => bill.leaseId === createdLeaseId)).toBeTruthy();
    await expect(page.locator('.van-tabs')).toBeVisible();
    await expect(
      page.locator('.bill-list-page .van-cell').filter({ hasText: tenantName }),
    ).toBeVisible();

    const homeDashboardPromises = [
      waitForApi(page, 'GET', '/dashboard/vacancy'),
      waitForApi(page, 'GET', '/dashboard/expiring'),
      waitForApi(page, 'GET', '/dashboard/overdue'),
      waitForApi(page, 'GET', '/payments/pending'),
    ];
    await page.locator('.van-tabbar-item').filter({ hasText: '工作台' }).click();
    for (const response of await Promise.all(homeDashboardPromises)) {
      await expectApiSuccess(response);
    }

    const pendingPagePromise = waitForApi(page, 'GET', '/payments/pending');
    await page.getByText('待确认收款', { exact: true }).click();
    await expectApiSuccess(await pendingPagePromise);
    await expect(page.locator('.van-nav-bar')).toContainText('待确认收款');
    await expect(page.locator('.van-notice-bar')).toBeVisible();
  });

  test('tenant-h5: mock 登录、邀请码绑定并看到新租约账单', async ({ page }) => {
    expect(inviteCode, '房东流程应先生成邀请码').not.toBe('');
    expect(createdLeaseId, '房东流程应先创建租约').toBeGreaterThan(0);

    await page.goto(`${tenantBaseUrl}/login`);

    // 第二条独立的 Vant 注册回归哨兵。
    await expect(page.locator('.van-cell-group')).toBeVisible();
    await expect(page.locator('.van-button')).toBeVisible();

    const loginPromise = waitForApi(page, 'POST', '/auth/tenant/login');
    await page.getByPlaceholder('输入 mock_openid').fill(tenantOpenid);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    const login = await expectApiSuccess<{ bound: boolean }>(await loginPromise);
    expect(login.bound).toBe(false);

    await expect(page.getByText('首次使用请输入房东提供的邀请码绑定租约')).toBeVisible();
    await page.getByPlaceholder('输入邀请码').fill(inviteCode);

    const bindPromise = waitForApi(page, 'POST', '/tenant/bind');
    const myBillsPromise = waitForApi(page, 'GET', '/tenant/bills');
    await page.getByRole('button', { name: '绑定', exact: true }).click();

    const bind = await expectApiSuccess<{ leaseId: number; token: string }>(await bindPromise);
    expect(bind.leaseId).toBe(createdLeaseId);
    expect(bind.token).toBeTruthy();

    const leases = await expectApiSuccess<
      Array<{ id: number; bills: Array<{ totalAmount: string | number }> }>
    >(await myBillsPromise);
    const createdLease = leases.find((lease) => lease.id === createdLeaseId);
    expect(createdLease).toBeTruthy();
    expect(createdLease?.bills.length).toBeGreaterThan(0);
    expect(createdLease?.bills.some((bill) => Number(bill.totalAmount) === rent)).toBeTruthy();

    await expect(page).toHaveURL(`${tenantBaseUrl}/`);
    await expect(page.locator('.van-nav-bar')).toContainText('我的账单');
    await expect(page.locator('.my-bills-page .van-cell')).toContainText(`¥${rent}`);
    await expect(page.locator('.my-bills-page .van-tag')).toContainText('待付');
  });
});
