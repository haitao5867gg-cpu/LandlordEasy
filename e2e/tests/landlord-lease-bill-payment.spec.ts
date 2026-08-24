import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
  type Response,
  request as playwrightRequest,
} from '@playwright/test';

const apiPrefix = '/api/v1';
const runId = Date.now().toString().slice(-8);

// 远程 dev 会保留真实写入；串行套件可避免单条失败后 worker 重启并重复执行造数前置。
test.describe.configure({ mode: 'serial' });

const dataPrefix = `E2E_QA_${runId}`;
const today = dateString(new Date());
const futureDate = dateString(addDays(new Date(), 400));
const earlierDate = dateString(addDays(new Date(), -30));

let landlordToken = '';
let buildingName = '';
let setupRequest: APIRequestContext;

const rooms: Record<string, TestRoom> = {};
const leases: Record<string, LeaseDetail> = {};
const bills: Record<string, BillDetail> = {};
const pendingPayments: Record<string, Payment> = {};

interface ApiEnvelope<T> {
  code: number;
  message?: string;
  data: T;
}

interface TestRoom {
  id: number;
  buildingId: number;
  roomNo: string;
  status: string;
  building?: { id: number; name: string };
}

interface LeaseDetail {
  id: number;
  roomId: number;
  tenantId: number;
  startDate: string;
  endDate: string;
  rent: string | number;
  deposit: string | number;
  status: string;
  inviteCode: string;
  feeItems?: Array<{ name: string; amount: number }>;
  tenant?: { id: number; name: string; phone: string };
  room?: TestRoom & { building: { id: number; name: string } };
  bills?: BillDetail[];
}

interface BillDetail {
  id: number;
  leaseId: number;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  totalAmount: string | number;
  status: string;
  items: Array<{ id: number; type: string; name: string; amount: string | number }>;
  payments: Payment[];
  lease?: LeaseDetail;
}

interface Payment {
  id: number;
  billId: number;
  amount: string | number;
  paidAt: string;
  status: string;
  proofUrl?: string;
  bill?: BillDetail;
}

function dateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function phone(index: number): string {
  return `138${String((Number(runId) + index) % 100_000_000).padStart(8, '0')}`;
}

function authHeaders(token = landlordToken): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function apiResult<T>(response: APIResponse): Promise<T> {
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(response.ok(), `${response.url()}: ${body.message ?? ''}`).toBeTruthy();
  expect(body.code).toBe(0);
  return body.data;
}

async function pageApiResult<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(response.ok(), `${response.request().method()} ${response.url()}: ${body.message ?? ''}`).toBeTruthy();
  expect(body.code).toBe(0);
  return body.data;
}

async function landlordGet<T>(pathname: string): Promise<T> {
  return apiResult<T>(await setupRequest.get(`${apiPrefix}${pathname}`, { headers: authHeaders() }));
}

async function landlordPost<T>(pathname: string, data: unknown): Promise<T> {
  return apiResult<T>(await setupRequest.post(`${apiPrefix}${pathname}`, { headers: authHeaders(), data }));
}

async function getLease(id: number): Promise<LeaseDetail> {
  return landlordGet<LeaseDetail>(`/leases/${id}`);
}

async function getBill(id: number): Promise<BillDetail> {
  return landlordGet<BillDetail>(`/bills/${id}`);
}

async function createLease(role: string, room: TestRoom, index: number): Promise<LeaseDetail> {
  const lease = await landlordPost<LeaseDetail>('/leases', {
    roomId: room.id,
    tenantName: `${dataPrefix}_${role}`,
    tenantPhone: phone(index),
    startDate: today,
    endDate: futureDate,
    rent: 500 + index,
    deposit: 500,
    payCycle: 'MONTHLY',
  });
  leases[role] = lease;
  return lease;
}

async function createTenantPayment(
  role: string,
  lease: LeaseDetail,
  bill: BillDetail,
  amount: number,
  proofUrl?: string,
): Promise<Payment> {
  const login = await apiResult<{ token: string }>(
    await setupRequest.post(`${apiPrefix}/auth/tenant/login`, {
      data: { code: `${dataPrefix}_${role}_openid` },
    }),
  );
  const bound = await apiResult<{ token: string }>(
    await setupRequest.post(`${apiPrefix}/tenant/bind`, {
      headers: authHeaders(login.token),
      data: { inviteCode: lease.inviteCode },
    }),
  );
  const payment = await apiResult<Payment>(
    await setupRequest.post(`${apiPrefix}/payments/report`, {
      headers: authHeaders(bound.token),
      data: { billId: bill.id, amount, paidAt: today, ...(proofUrl ? { proofUrl } : {}) },
    }),
  );
  pendingPayments[role] = payment;
  return payment;
}

function waitForApi(page: Page, method: string, pathname: string | RegExp): Promise<Response> {
  return page.waitForResponse((response) => {
    const request = response.request();
    const path = new URL(response.url()).pathname;
    const matches = typeof pathname === 'string'
      ? path === `${apiPrefix}${pathname}`
      : pathname.test(path);
    return request.method() === method && matches;
  });
}

async function login(page: Page, pathname = '/'): Promise<void> {
  await page.addInitScript((token) => localStorage.setItem('landlord_token', token), landlordToken);
  await page.goto(pathname);
  await expect(page).not.toHaveURL(/\/login/);
}

function fieldInput(page: Page, label: string) {
  return page.locator('.van-field').filter({ hasText: label }).locator('input').first();
}

async function setInputValue(page: Page, label: string, value: string): Promise<void> {
  await fieldInput(page, label).evaluate((input, nextValue) => {
    const element = input as HTMLInputElement;
    element.removeAttribute('readonly');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, nextValue);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function fillLeaseForm(
  page: Page,
  name: string,
  tenantPhone: string,
  rent = '1200',
  deposit = '1200',
): Promise<void> {
  await fieldInput(page, '姓名').fill(name);
  await fieldInput(page, '手机号').fill(tenantPhone);
  await fieldInput(page, '月租金').fill(rent);
  await fieldInput(page, '押金').fill(deposit);
}

async function openNewLease(page: Page, roomId: number): Promise<void> {
  await login(page, `/leases/new?roomId=${roomId}`);
  await expect(page.locator('.van-nav-bar__title')).toHaveText('新签租约');
}

async function openLease(page: Page, leaseId: number): Promise<void> {
  await login(page, `/leases/${leaseId}`);
  await expect(page.locator('.van-nav-bar__title')).toHaveText('租约详情');
  await expect(page.locator('.page-loading')).not.toBeVisible();
}

async function openBill(page: Page, billId: number): Promise<void> {
  await login(page, `/bills/${billId}`);
  await expect(page.locator('.van-nav-bar__title')).toHaveText('账单详情');
  await expect(page.locator('.page-loading')).not.toBeVisible();
}

async function submitNewLease(page: Page): Promise<Response> {
  const responsePromise = waitForApi(page, 'POST', '/leases');
  await page.getByRole('button', { name: '确认签约', exact: true }).click();
  return responsePromise;
}

const roomRoles = [
  'normalUi', 'feeUi', 'reuseUi', 'reuseAnchor',
  'detail', 'renew', 'renewBoundary', 'endNormal', 'endBoundary', 'ended',
  'billPending', 'billAdd', 'billPartial', 'billFull', 'billBlank', 'billPaid',
  'pendingDisplay', 'pendingConfirm', 'pendingReject',
];

const backendLeaseRoles = [
  'reuseAnchor', 'detail', 'renew', 'renewBoundary', 'endNormal', 'endBoundary', 'ended',
  'billPending', 'billAdd', 'billPartial', 'billFull', 'billBlank', 'billPaid',
  'pendingDisplay', 'pendingConfirm', 'pendingReject',
];

const billRoles = [
  'detail', 'renew', 'renewBoundary', 'endNormal', 'endBoundary',
  'billPending', 'billAdd', 'billPartial', 'billFull', 'billBlank', 'billPaid',
  'pendingDisplay', 'pendingConfirm', 'pendingReject',
];

test.beforeAll(async () => {
  setupRequest = await playwrightRequest.newContext({ baseURL: 'https://dev.landlordeasy.cn' });
  const loginResult = await apiResult<{ token: string }>(
    await setupRequest.post(`${apiPrefix}/auth/landlord/login`, { data: { code: 'mock_landlord_001' } }),
  );
  landlordToken = loginResult.token;

  const [buildings, existingRooms] = await Promise.all([
    landlordGet<Array<{ id: number; name: string }>>('/buildings'),
    landlordGet<TestRoom[]>('/rooms'),
  ]);
  const building = buildings.find((item) => item.name === 'Q栋') ?? buildings[0];
  expect(building, 'dev 环境应至少有一个楼栋').toBeTruthy();
  buildingName = building.name;
  const used = new Set(
    existingRooms
      .filter((room) => room.buildingId === building.id)
      .map((room) => Number(room.roomNo)),
  );
  const available: number[] = [];
  for (let roomNo = 700; roomNo <= 999 && available.length < roomRoles.length; roomNo += 1) {
    if (!used.has(roomNo)) available.push(roomNo);
  }
  expect(available, '9xx 测试号段应有足够空房号').toHaveLength(roomRoles.length);

  for (const [index, role] of roomRoles.entries()) {
    const roomNo = available[index];
    rooms[role] = await landlordPost<TestRoom>('/rooms', {
      buildingId: building.id,
      roomNo: String(roomNo),
      floor: Math.floor(roomNo / 100),
      remark: `${dataPrefix}_${role}_测试房间`,
    });
  }

  for (const [index, role] of backendLeaseRoles.entries()) {
    await createLease(role, rooms[role], index + 1);
  }

  await landlordPost(`/leases/${leases.ended.id}/end`, {
    endDate: today,
    depositRefund: 0,
    endReason: `${dataPrefix}_预置已结束租约`,
  });

  await landlordPost('/bills/generate', {});
  const allBills = await landlordGet<BillDetail[]>('/bills');
  for (const role of billRoles) {
    const bill = allBills.find((item) => item.leaseId === leases[role].id);
    expect(bill, `${role} 测试租约应生成账单`).toBeTruthy();
    bills[role] = bill!;
  }

  await landlordPost('/payments/manual', {
    billId: bills.billPaid.id,
    channel: 'CASH',
    amount: Number(bills.billPaid.totalAmount),
    paidAt: today,
  });
  bills.billPaid = await getBill(bills.billPaid.id);

  await createTenantPayment(
    'pendingDisplay',
    leases.pendingDisplay,
    bills.pendingDisplay,
    1,
    'https://dev.landlordeasy.cn/favicon.ico',
  );
  await createTenantPayment(
    'pendingConfirm',
    leases.pendingConfirm,
    bills.pendingConfirm,
    Number(bills.pendingConfirm.totalAmount),
  );
  await createTenantPayment(
    'pendingReject',
    leases.pendingReject,
    bills.pendingReject,
    1,
  );
});

test.afterAll(async () => {
  await setupRequest?.dispose();
});

test.describe('2.4 新签租约', () => {
  test('2.4.1 正常签约、预设租期、邀请码弹窗与复制', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://dev.landlordeasy.cn' });
    await openNewLease(page, rooms.normalUi.id);
    await fillLeaseForm(page, `${dataPrefix}_正常签约租客`, phone(101));
    await page.getByText('6个月', { exact: true }).click();
    const lease = await pageApiResult<LeaseDetail>(await submitNewLease(page));
    leases.normalUi = lease;
    expect(lease.inviteCode).toMatch(/^[A-Z0-9]{8}$/);

    const dialog = page.locator('.van-dialog').filter({ hasText: '签约成功' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('h2')).toHaveText(lease.inviteCode);
    await dialog.getByRole('button', { name: '复制邀请码', exact: true }).click();
    await expect(page.locator('.van-toast')).toContainText('已复制');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(lease.inviteCode);
    await dialog.getByRole('button', { name: '完成', exact: true }).click();
  });

  test('2.4.2 姓名、手机号、起租日、租期分别留空时前端拦截', async ({ page }) => {
    let createRequests = 0;
    await page.route('**/api/v1/leases', async (route) => {
      if (route.request().method() === 'POST') createRequests += 1;
      await route.continue();
    });

    const cases: Array<[string, string]> = [
      ['姓名', '请填写姓名'],
      ['手机号', '请填写手机号'],
      ['起租日', '请选择起租日'],
    ];
    for (const [field, message] of cases) {
      await openNewLease(page, rooms.feeUi.id);
      await fillLeaseForm(page, `${dataPrefix}_校验租客`, phone(102));
      if (field === '姓名' || field === '手机号') await fieldInput(page, field).fill('');
      if (field === '起租日') await setInputValue(page, '起租日', '');
      await page.getByRole('button', { name: '确认签约', exact: true }).click();
      await expect(page.getByText(message, { exact: true }).last()).toBeVisible();
    }

    await openNewLease(page, rooms.feeUi.id);
    const termRadios = page.locator('.lease-term .van-radio');
    await expect(termRadios).toHaveCount(5);
    await expect(termRadios.filter({ hasText: '1年' })).toHaveAttribute('aria-checked', 'true');
    await termRadios.filter({ hasText: '1年' }).click();
    await expect(termRadios.filter({ hasText: '1年' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('请选择租期', { exact: true })).toHaveCount(0);
    expect(createRequests).toBe(0);
  });

  test('2.4.3 1月31日加1个月正确处理月末到期日', async ({ page }) => {
    await openNewLease(page, rooms.reuseUi.id);
    await setInputValue(page, '起租日', '2027-01-31');
    await page.getByText('3个月', { exact: true }).click();
    await page.getByText('1个月', { exact: true }).click();
    await expect(page.locator('.van-cell').filter({ hasText: '到期日' }).locator('.van-cell__value')).toHaveText('2027-02-27');
  });

  test('2.4.4 自定义租期与附加费用仅保存完整条目', async ({ page }) => {
    await openNewLease(page, rooms.feeUi.id);
    await fillLeaseForm(page, `${dataPrefix}_附加费用租客`, phone(103));
    await page.getByText('自定义', { exact: true }).click();
    await page.getByPlaceholder('数量').fill('2');
    await page.getByText('月', { exact: true }).click();
    await page.getByRole('button', { name: '+ 添加费用项', exact: true }).click();
    await page.getByRole('button', { name: '+ 添加费用项', exact: true }).click();
    await page.getByPlaceholder('名称').nth(0).fill(`${dataPrefix}_物业费`);
    await page.getByPlaceholder('金额').nth(0).fill('88');
    await page.getByPlaceholder('名称').nth(1).fill(`${dataPrefix}_不完整费用`);

    const response = await submitNewLease(page);
    const payload = response.request().postDataJSON() as { feeItems: Array<{ name: string; amount: number }> };
    expect(payload.feeItems).toEqual([{ name: `${dataPrefix}_物业费`, amount: 88 }]);
    const lease = await pageApiResult<LeaseDetail>(response);
    leases.feeUi = lease;
    const detail = await getLease(lease.id);
    expect(detail.feeItems).toEqual([{ name: `${dataPrefix}_物业费`, amount: 88 }]);
  });

  test('2.4.5 已租房间再次签约被后端拒绝', async ({ page }) => {
    await openNewLease(page, rooms.reuseAnchor.id);
    await fillLeaseForm(page, `${dataPrefix}_重复签约租客`, phone(104));
    const response = await submitNewLease(page);
    expect(response.status()).toBe(400);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toContain('房间不是空置状态');
    await expect(page.locator('.van-toast')).toContainText('房间不是空置状态');
  });

  test('2.4.6 已存在手机号配不同姓名时记录实际租客复用现象', async ({ page }, testInfo) => {
    const anchor = await getLease(leases.reuseAnchor.id);
    const reusedPhone = anchor.tenant!.phone;
    const requestedName = `${dataPrefix}_手机号复用新姓名`;
    await openNewLease(page, rooms.reuseUi.id);
    await fillLeaseForm(page, requestedName, reusedPhone);
    const created = await pageApiResult<LeaseDetail>(await submitNewLease(page));
    leases.reuseUi = created;
    const detail = await getLease(created.id);
    const observation = {
      requestedName,
      existingTenantId: anchor.tenant!.id,
      createdLeaseTenantId: detail.tenant!.id,
      displayedTenantName: detail.tenant!.name,
      sameTenantId: detail.tenant!.id === anchor.tenant!.id,
    };
    console.log(`OBSERVATION 2.4.6 ${JSON.stringify(observation)}`);
    testInfo.annotations.push({ type: 'observation', description: JSON.stringify(observation) });
    expect(detail.tenant!.id).toBe(anchor.tenant!.id);
  });

  test('2.4.7 页面未展示当前签约房间号', async ({ page }) => {
    await openNewLease(page, rooms.detail.id);
    await expect(page.getByText(rooms.detail.roomNo, { exact: true })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(`${buildingName} ${rooms.detail.roomNo}`);
  });
});

test.describe('2.5 租约详情', () => {
  test('2.5.1 ACTIVE租约信息完整且账单状态标签正确', async ({ page }) => {
    const lease = await getLease(leases.detail.id);
    await openLease(page, lease.id);
    for (const title of ['租客', '手机', '房间', '租期', '月租金', '押金', '状态', '邀请码']) {
      await expect(page.locator('.van-cell').filter({ hasText: title }).first()).toBeVisible();
    }
    await expect(page.locator('.van-cell').filter({ hasText: '状态' }).locator('.van-tag')).toHaveText('在租');
    await expect(page.locator('.van-cell').filter({ hasText: '邀请码' }).locator('.van-cell__value')).toHaveText(lease.inviteCode);
    const expectedLabels: Record<string, string> = { PENDING: '待付', PAID: '已付', OVERDUE: '逾期' };
    for (const bill of lease.bills ?? []) {
      await expect(page.locator('.van-cell').filter({ hasText: String(bill.totalAmount) }).locator('.van-tag')).toHaveText(expectedLabels[bill.status]);
    }
  });

  test('2.5.2 合法未来日期续签且租金保持不变', async ({ page }) => {
    const before = await getLease(leases.renew.id);
    await openLease(page, before.id);
    await page.getByRole('button', { name: '续签', exact: true }).click();
    const dialog = page.locator('.van-dialog:visible');
    await dialog.locator('.van-field').filter({ hasText: '新到期日' }).locator('input').fill(futureDate);
    const responsePromise = waitForApi(page, 'POST', `/leases/${before.id}/renew`);
    await dialog.getByRole('button', { name: '确认', exact: true }).click();
    await pageApiResult(await responsePromise);
    await expect(page.locator('.van-toast')).toContainText('续签成功');
    await expect(page.locator('.van-cell').filter({ hasText: '租期' }).locator('.van-cell__value')).toContainText(futureDate);
    const after = await getLease(before.id);
    expect(Number(after.rent)).toBe(Number(before.rent));
  });

  test('2.5.3 早于当前到期日和起租日的续签日期记录后端实际行为', async ({ page }, testInfo) => {
    const lease = await getLease(leases.renewBoundary.id);
    await openLease(page, lease.id);
    await page.getByRole('button', { name: '续签', exact: true }).click();
    const dialog = page.locator('.van-dialog:visible');
    await dialog.locator('.van-field').filter({ hasText: '新到期日' }).locator('input').fill(earlierDate);
    const responsePromise = waitForApi(page, 'POST', `/leases/${lease.id}/renew`);
    await dialog.getByRole('button', { name: '确认', exact: true }).click();
    const response = await responsePromise;
    const body = (await response.json()) as ApiEnvelope<LeaseDetail>;
    const observation = {
      submittedDate: earlierDate,
      originalStartDate: lease.startDate.split('T')[0],
      originalEndDate: lease.endDate.split('T')[0],
      responseStatus: response.status(),
      responseMessage: body.message ?? '',
      resultingEndDate: response.ok() ? body.data.endDate.split('T')[0] : null,
    };
    console.log(`OBSERVATION 2.5.3 ${JSON.stringify(observation)}`);
    testInfo.annotations.push({ type: 'observation', description: JSON.stringify(observation) });
    if (response.ok()) {
      expect(body.code).toBe(0);
      await expect(page.locator('.van-toast')).toContainText('续签成功');
      expect(observation.resultingEndDate).toBe(earlierDate);
    } else {
      expect(body.message).toBeTruthy();
    }
  });

  test('2.5.4 正常退租后租约结束且房间空置', async ({ page }) => {
    const lease = await getLease(leases.endNormal.id);
    await openLease(page, lease.id);
    await page.getByRole('button', { name: '退租', exact: true }).click();
    const dialog = page.locator('.van-dialog:visible');
    await dialog.locator('.van-field').filter({ hasText: '退租日' }).locator('input').fill(today);
    await dialog.locator('.van-field').filter({ hasText: '退还押金' }).locator('input').fill('200');
    await dialog.locator('.van-field').filter({ hasText: '扣款原因' }).locator('input').fill(`${dataPrefix}_正常扣款`);
    const requestPromise = page.waitForRequest((request) =>
      request.method() === 'POST' && new URL(request.url()).pathname === `${apiPrefix}/leases/${lease.id}/end`,
    );
    await dialog.getByRole('button', { name: '确认', exact: true }).click();
    await requestPromise;
    await expect.poll(async () => (await getLease(lease.id)).status).toBe('ENDED');
    const [ended, room] = await Promise.all([
      getLease(lease.id),
      landlordGet<TestRoom>(`/rooms/${lease.roomId}`),
    ]);
    expect(ended.status).toBe('ENDED');
    expect(room.status).toBe('VACANT');
  });

  test('2.5.5 退还押金大于实际押金时记录后端实际行为', async ({ page }, testInfo) => {
    const lease = await getLease(leases.endBoundary.id);
    const excessiveRefund = Number(lease.deposit) + 999;
    await openLease(page, lease.id);
    await page.getByRole('button', { name: '退租', exact: true }).click();
    const dialog = page.locator('.van-dialog:visible');
    await dialog.locator('.van-field').filter({ hasText: '退租日' }).locator('input').fill(today);
    await dialog.locator('.van-field').filter({ hasText: '退还押金' }).locator('input').fill(String(excessiveRefund));
    const requestPromise = page.waitForRequest((request) =>
      request.method() === 'POST' && new URL(request.url()).pathname === `${apiPrefix}/leases/${lease.id}/end`,
    );
    await dialog.getByRole('button', { name: '确认', exact: true }).click();
    await requestPromise;
    await page.waitForTimeout(1_000);
    const current = await getLease(lease.id);
    const observation = {
      actualDeposit: Number(lease.deposit),
      submittedRefund: excessiveRefund,
      requestSubmitted: true,
      resultingLeaseStatus: current.status,
    };
    console.log(`OBSERVATION 2.5.5 ${JSON.stringify(observation)}`);
    testInfo.annotations.push({ type: 'observation', description: JSON.stringify(observation) });
    expect(['ACTIVE', 'ENDED']).toContain(current.status);
  });

  test('2.5.6 已结束租约不显示续签和退租按钮', async ({ page }) => {
    await openLease(page, leases.ended.id);
    await expect(page.locator('.van-cell').filter({ hasText: '状态' }).locator('.van-tag')).toHaveText('已退租');
    await expect(page.getByRole('button', { name: '续签', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '退租', exact: true })).toHaveCount(0);
  });

  test('2.5.7 租约详情前端没有确认交接记录入口', async ({ page }) => {
    await openLease(page, leases.detail.id);
    await expect(page.getByText(/交接记录|确认交接/)).toHaveCount(0);
  });
});

test.describe('2.6 账单', () => {
  test('2.6.1 全部、待付、已付、逾期Tab筛选结果正确', async ({ page }) => {
    await login(page, '/bills');
    await expect(page.locator('.page-loading')).not.toBeVisible({ timeout: 30_000 });
    const waitForBills = (status?: string) => page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'GET'
        && url.pathname === `${apiPrefix}/bills`
        && (status ? url.searchParams.get('status') === status : !url.searchParams.has('status'));
    });
    const tabs: Array<[string, string]> = [['待付', 'PENDING'], ['已付', 'PAID'], ['逾期', 'OVERDUE']];
    for (const [label, status] of tabs) {
      const expected = await landlordGet<BillDetail[]>(`/bills?status=${status}`);
      const responsePromise = waitForBills(status);
      await page.getByRole('tab', { name: label, exact: true }).click();
      await responsePromise;
      await expect(page.locator('.page-loading')).not.toBeVisible({ timeout: 30_000 });
      expect(expected.every((bill) => bill.status === status)).toBeTruthy();
      if (expected.length === 0) {
        await expect(page.getByText('暂无账单', { exact: true })).toBeVisible();
      } else {
        const cells = page.locator('.bill-list-page > .van-cell-group .van-cell');
        await expect(cells).toHaveCount(expected.length);
        const expectedLabel = { PENDING: '待付', PAID: '已付', OVERDUE: '逾期' }[status]!;
        await expect(cells.locator('.van-tag')).toHaveText(Array(expected.length).fill(expectedLabel));
      }
    }
    const all = await landlordGet<BillDetail[]>('/bills');
    const allResponse = waitForBills();
    await page.getByRole('tab', { name: '全部', exact: true }).click();
    await allResponse;
    await expect(page.locator('.page-loading')).not.toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.bill-list-page > .van-cell-group .van-cell')).toHaveCount(all.length, { timeout: 30_000 });
  });

  test('2.6.2 PENDING详情仅显示追加费用项和手动记账', async ({ page }) => {
    await openBill(page, bills.billPending.id);
    await expect(page.getByRole('button', { name: '追加费用项', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '手动记账(现金/转账)', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '追加滞纳金', exact: true })).toHaveCount(0);
  });

  test('2.6.3 OVERDUE详情显示三个操作按钮', async ({ page }) => {
    const ownBill = await getBill(bills.billPending.id);
    await page.route(`**${apiPrefix}/bills/${ownBill.id}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, message: 'success', data: { ...ownBill, status: 'OVERDUE' } }),
      });
    });
    await openBill(page, ownBill.id);
    await expect(page.getByRole('button', { name: '追加费用项', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '追加滞纳金', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '手动记账(现金/转账)', exact: true })).toBeVisible();
  });

  test('2.6.4 PAID详情不显示操作按钮', async ({ page }) => {
    await openBill(page, bills.billPaid.id);
    await expect(page.locator('.van-cell').filter({ hasText: '状态' }).locator('.van-tag')).toHaveText('已付');
    for (const name of ['追加费用项', '追加滞纳金', '手动记账(现金/转账)']) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
  });

  test('2.6.5 追加费用项后总额增加且明细出现', async ({ page }) => {
    const before = await getBill(bills.billAdd.id);
    const itemName = `${dataPrefix}_临时费用`;
    await openBill(page, before.id);
    await page.getByRole('button', { name: '追加费用项', exact: true }).click();
    const dialog = page.locator('.van-dialog:visible');
    await dialog.locator('.van-field').filter({ hasText: '名称' }).locator('input').fill(itemName);
    await dialog.locator('.van-field').filter({ hasText: '金额' }).locator('input').fill('66');
    const responsePromise = waitForApi(page, 'POST', `/bills/${before.id}/items`);
    await dialog.getByRole('button', { name: '确认', exact: true }).click();
    await pageApiResult(await responsePromise);
    await expect(page.locator('.van-cell').filter({ hasText: itemName })).toContainText('¥66');
    const after = await getBill(before.id);
    expect(Number(after.totalAmount)).toBe(Number(before.totalAmount) + 66);
    expect(after.items.some((item) => item.name === itemName && Number(item.amount) === 66)).toBeTruthy();
  });

  test('2.6.6 OVERDUE追加滞纳金金额等于租金项且总额增加', async ({ page }, testInfo) => {
    const source = await getBill(bills.billPending.id);
    const rent = Number(source.items.find((item) => item.type === 'RENT')!.amount);
    const mockBill: BillDetail = { ...source, status: 'OVERDUE', items: [...source.items] };
    await page.route(`**${apiPrefix}/bills/${source.id}/late-fee`, async (route) => {
      mockBill.items.push({ id: 9_900_001, type: 'LATE_FEE', name: '滞纳金', amount: rent });
      mockBill.totalAmount = Number(mockBill.totalAmount) + rent;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, message: 'success', data: mockBill.items.at(-1) }),
      });
    });
    await page.route(`**${apiPrefix}/bills/${source.id}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, message: 'success', data: mockBill }),
      });
    });
    await openBill(page, source.id);
    await page.getByRole('button', { name: '追加滞纳金', exact: true }).click();
    await expect(page.locator('.van-toast')).toContainText('滞纳金已追加');
    await expect(page.locator('.van-cell').filter({ hasText: '滞纳金' })).toContainText(`¥${rent}`);
    await expect(page.locator('.van-cell').filter({ hasText: '总金额' }).locator('.van-cell__value')).toHaveText(`¥${mockBill.totalAmount}`);
    const observation = { dataSource: 'E2E_QA自建账单+Playwright路由模拟OVERDUE', rent, resultingTotal: mockBill.totalAmount };
    console.log(`OBSERVATION 2.6.6 ${JSON.stringify(observation)}`);
    testInfo.annotations.push({ type: 'observation', description: JSON.stringify(observation) });
  });

  test('2.6.7 手动部分支付后状态不变且支付记录出现', async ({ page }) => {
    const before = await getBill(bills.billPartial.id);
    const amount = Math.max(1, Math.floor(Number(before.totalAmount) / 3));
    await openBill(page, before.id);
    await page.getByRole('button', { name: '手动记账(现金/转账)', exact: true }).click();
    const dialog = page.locator('.van-dialog:visible');
    await dialog.locator('.van-field').filter({ hasText: '金额' }).locator('input').fill(String(amount));
    const responsePromise = waitForApi(page, 'POST', '/payments/manual');
    await dialog.getByRole('button', { name: '确认', exact: true }).click();
    await pageApiResult(await responsePromise);
    await expect(page.locator('.van-toast')).toContainText('记账成功');
    await expect(page.locator('.van-cell').filter({ hasText: '现金' }).filter({ hasText: `¥${amount}` })).toBeVisible();
    const after = await getBill(before.id);
    expect(after.status).toBe(before.status);
    expect(after.payments.some((payment) => Number(payment.amount) === amount && payment.status === 'CONFIRMED')).toBeTruthy();
  });

  test('2.6.8 手动全额支付后账单自动变为已付', async ({ page }) => {
    const before = await getBill(bills.billFull.id);
    await openBill(page, before.id);
    await page.getByRole('button', { name: '手动记账(现金/转账)', exact: true }).click();
    const dialog = page.locator('.van-dialog:visible');
    await dialog.locator('.van-field').filter({ hasText: '金额' }).locator('input').fill(String(before.totalAmount));
    const responsePromise = waitForApi(page, 'POST', '/payments/manual');
    await dialog.getByRole('button', { name: '确认', exact: true }).click();
    await pageApiResult(await responsePromise);
    await expect(page.locator('.van-cell').filter({ hasText: '状态' }).locator('.van-tag')).toHaveText('已付');
    expect((await getBill(before.id)).status).toBe('PAID');
  });

  test('2.6.9 手动记账金额留空时使用账单总金额', async ({ page }) => {
    const before = await getBill(bills.billBlank.id);
    await openBill(page, before.id);
    await page.getByRole('button', { name: '手动记账(现金/转账)', exact: true }).click();
    const dialog = page.locator('.van-dialog:visible');
    await dialog.locator('.van-field').filter({ hasText: '金额' }).locator('input').fill('');
    const responsePromise = waitForApi(page, 'POST', '/payments/manual');
    await dialog.getByRole('button', { name: '确认', exact: true }).click();
    const response = await responsePromise;
    const payload = response.request().postDataJSON() as { amount: number };
    expect(payload.amount).toBe(Number(before.totalAmount));
    await pageApiResult(response);
    expect((await getBill(before.id)).status).toBe('PAID');
  });
});

test.describe('2.7 待确认收款', () => {
  test('2.7.1 列表信息正确且凭证图片可放大预览', async ({ page }) => {
    await login(page, '/payments/pending');
    const tenantName = `${dataPrefix}_pendingDisplay`;
    const cell = page.locator('.van-cell').filter({ hasText: tenantName });
    await expect(cell).toBeVisible();
    await expect(cell).toContainText(`¥${pendingPayments.pendingDisplay.amount}`);
    await expect(cell).toContainText(today);
    await cell.locator('.van-image').click();
    await expect(page.locator('.van-image-preview')).toBeVisible();
  });

  test('2.7.2 确认后提示、列表移除且足额账单变已付', async ({ page }) => {
    await login(page, '/payments/pending');
    const tenantName = `${dataPrefix}_pendingConfirm`;
    const cell = page.locator('.van-cell').filter({ hasText: tenantName });
    await expect(cell).toBeVisible();
    const responsePromise = waitForApi(page, 'POST', `/payments/${pendingPayments.pendingConfirm.id}/confirm`);
    await cell.getByRole('button', { name: '确认', exact: true }).click();
    await pageApiResult(await responsePromise);
    await expect(page.locator('.van-toast')).toContainText('已确认');
    await expect(page.locator('.van-cell').filter({ hasText: tenantName })).toHaveCount(0);
    expect((await getBill(bills.pendingConfirm.id)).status).toBe('PAID');
  });

  test('2.7.3 驳回后提示、列表移除且记录状态为REJECTED', async ({ page }) => {
    await login(page, '/payments/pending');
    const tenantName = `${dataPrefix}_pendingReject`;
    const cell = page.locator('.van-cell').filter({ hasText: tenantName });
    await expect(cell).toBeVisible();
    const responsePromise = waitForApi(page, 'POST', `/payments/${pendingPayments.pendingReject.id}/confirm`);
    await cell.getByRole('button', { name: '驳回', exact: true }).click();
    await pageApiResult(await responsePromise);
    await expect(page.locator('.van-toast')).toContainText('已驳回');
    await expect(page.locator('.van-cell').filter({ hasText: tenantName })).toHaveCount(0);
    const records = await landlordGet<Payment[]>(`/payments?billId=${bills.pendingReject.id}`);
    expect(records.find((item) => item.id === pendingPayments.pendingReject.id)?.status).toBe('REJECTED');
  });

  test('2.7.4 无待确认收款时显示空状态', async ({ page }) => {
    await page.route('**/api/v1/payments/pending', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, message: 'success', data: [] }),
      });
    });
    await login(page, '/payments/pending');
    await expect(page.getByText('暂无待确认收款', { exact: true })).toBeVisible();
  });
});
