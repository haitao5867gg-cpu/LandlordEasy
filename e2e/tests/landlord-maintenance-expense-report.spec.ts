import {
  expect,
  test,
  request as playwrightRequest,
  type APIRequestContext,
  type APIResponse,
  type Page,
  type Response,
} from '@playwright/test';

const apiPrefix = '/api/v1';
const initialRunId = Date.now().toString();
let dataPrefix = `E2E_QA_${initialRunId}`;
const today = new Date().toISOString().slice(0, 10);
const reportMonth = '2026-08';

// 远程 dev 的新增记录无法从前端删除。串行执行可避免失败后其他用例换 worker 继续造数。
test.describe.configure({ mode: 'serial' });

let setupRequest: APIRequestContext;
let landlordToken = '';
let knownRoomId = 0;
let blockWrites = false;

interface ApiEnvelope<T> {
  code: number;
  message?: string;
  data: T;
}

interface Room {
  id: number;
  roomNo: string;
  buildingId: number;
  building?: { id: number; name: string };
}

interface VacancyRoom extends Room {
  vacantDays: number;
  vacantSince: string;
}

interface VacancyBoard {
  total: number;
  buildings: Record<string, VacancyRoom[]>;
}

interface ExpiringLease {
  id: number;
  endDate: string;
  daysLeft: number;
  room?: Room & { building?: { id: number; name: string } };
  tenant?: { id: number; name: string };
}

interface OverdueItem {
  billId: number;
  tenantName: string;
  roomNo: string;
  buildingName: string;
  amount: string | number;
  dueDate: string;
  overdueDays: number;
}

interface OverdueBoard {
  total: number;
  buildings: Record<string, OverdueItem[]>;
}

interface MaintenanceRecord {
  id: number;
  roomId: number;
  date: string;
  content: string;
  cost: string | number;
  createdAt?: string;
  room?: Room & { building?: { id: number; name: string } };
}

interface ExpenseRecord {
  id: number;
  date: string;
  category: string;
  name: string;
  amount: string | number;
  remark?: string;
}

interface MonthlyReport {
  month: string;
  receivable: number;
  received: number;
  collectionRate: number;
  netIncome: number;
  byBuilding: Record<string, { receivable: number; received: number; rate: number }>;
  expense: { total: number; byCategory: Record<string, number> };
  vacancy: { totalRooms: number; vacantRooms: number; vacancyRate: number; estimatedLoss: number };
}

interface DepositSummary {
  totalReceived: number;
  totalRefunded: number;
  totalDeducted: number;
  currentBalance: number;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${landlordToken}` };
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
  let lastResponse: APIResponse | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    lastResponse = await setupRequest.get(`${apiPrefix}${pathname}`, { headers: authHeaders() });
    if (lastResponse.status() !== 429 && lastResponse.status() < 500) return apiResult<T>(lastResponse);
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
  }
  return apiResult<T>(lastResponse!);
}

function waitForApi(
  page: Page,
  method: string,
  pathname: string,
  query?: Record<string, string>,
): Promise<Response> {
  return page.waitForResponse((response) => {
    const request = response.request();
    const url = new URL(response.url());
    return request.method() === method
      && url.pathname === `${apiPrefix}${pathname}`
      && Object.entries(query ?? {}).every(([key, value]) => url.searchParams.get(key) === value);
  });
}

async function login(page: Page, pathname: string): Promise<void> {
  await page.addInitScript((token) => localStorage.setItem('landlord_token', token), landlordToken);
  await page.goto(pathname);
  await expect(page).not.toHaveURL(/\/login/);
}

function visibleDialog(page: Page) {
  return page.locator('.van-dialog:visible');
}

function dialogField(page: Page, label: string) {
  return visibleDialog(page).locator('.van-field').filter({ hasText: label }).locator('input, textarea').first();
}

async function openAddDialog(page: Page): Promise<void> {
  await page.locator('.van-nav-bar__right .van-icon-plus').click();
  await expect(visibleDialog(page)).toBeVisible();
}

async function submitDialog(page: Page, pathname: string): Promise<Response> {
  const responsePromise = waitForApi(page, 'POST', pathname);
  await visibleDialog(page).getByRole('button', { name: '确认', exact: true }).click();
  return responsePromise;
}

async function responseObservation(response: Response): Promise<{ status: number; message: string }> {
  const body = (await response.json()) as { message?: string };
  return { status: response.status(), message: body.message ?? '' };
}

async function setReportMonth(page: Page, month: string): Promise<Response> {
  const responsePromise = waitForApi(page, 'GET', '/dashboard/reports/monthly', { month });
  const input = page.locator('.van-field').filter({ hasText: '月份' }).locator('input');
  await input.fill(month);
  await input.press('Tab');
  return responsePromise;
}

function pageHasInvalidNumberText(page: Page) {
  return page.locator('body').getByText(/NaN|undefined|null/, { exact: false });
}

test.beforeAll(async () => {
  setupRequest = await playwrightRequest.newContext({ baseURL: 'https://dev.landlordeasy.cn' });
  const loginResponse = await setupRequest.post(`${apiPrefix}/auth/landlord/login`, {
    data: { code: 'mock_landlord_001' },
  });
  landlordToken = (await apiResult<{ token: string }>(loginResponse)).token;

  const [rooms, maintenance, expenses] = await Promise.all([
    landlordGet<Room[]>('/rooms'),
    landlordGet<MaintenanceRecord[]>('/maintenance'),
    landlordGet<ExpenseRecord[]>('/expenses'),
  ]);
  expect(rooms.length, 'dev 环境应至少有一个真实房间').toBeGreaterThan(0);
  knownRoomId = rooms[0].id;

  // 若上一轮在写入维修后中断，短时重跑继续使用同一前缀，避免叠加新批次。
  const recentPartialRun = maintenance.find((item) => {
    const match = item.content?.match(/^(E2E_QA_\d+)_正常维修$/);
    if (!match || !item.createdAt) return false;
    return Date.now() - new Date(item.createdAt).getTime() < 60 * 60 * 1_000;
  });
  if (recentPartialRun) {
    dataPrefix = recentPartialRun.content.replace(/_正常维修$/, '');
    console.warn(`RESUME_PARTIAL_RUN ${dataPrefix}: 复用一小时内未完成批次，不重复新增已有记录`);
  }

  const matchingMaintenance = maintenance.filter((item) => item.content?.includes(dataPrefix));
  const matchingExpenses = expenses.filter((item) =>
    item.name?.includes(dataPrefix) || item.remark?.includes(dataPrefix));
  blockWrites = false;
  if (matchingMaintenance.length > 0 || matchingExpenses.length > 0) {
    console.warn(
      `DIRTY_PREFIX_WARNING ${dataPrefix}: maintenance=${matchingMaintenance.length}, expenses=${matchingExpenses.length}; 各用例将复用精确匹配记录`,
    );
  }
  console.log(`E2E_RUN_PREFIX ${dataPrefix}`);
});

test.afterAll(async () => {
  await setupRequest?.dispose();
});

test.describe('2.8 工作台看板明细', () => {
  test('2.8.1 空置房间按楼栋分组且空置天数合理', async ({ page }) => {
    const responsePromise = waitForApi(page, 'GET', '/dashboard/vacancy');
    await login(page, '/dashboard/vacancy');
    const board = await pageApiResult<VacancyBoard>(await responsePromise);

    await expect(page.locator('.van-nav-bar__title')).toHaveText('空置看板');
    await expect(page.locator('.van-cell').filter({ hasText: '空置总数' }).locator('.van-cell__value')).toHaveText(String(board.total));
    expect(Object.values(board.buildings).flat()).toHaveLength(board.total);

    for (const [buildingName, rooms] of Object.entries(board.buildings)) {
      await expect(page.locator('.van-cell-group__title', { hasText: `${buildingName}(${rooms.length}间)` })).toBeVisible();
    }

    const sample = Object.values(board.buildings).flat()[0];
    expect(sample, '当前 dev 应至少有一个空置房间供抽查').toBeTruthy();
    const calculatedDays = Math.floor((Date.now() - new Date(sample.vacantSince).getTime()) / 86_400_000);
    expect(Math.abs(sample.vacantDays - calculatedDays)).toBeLessThanOrEqual(1);
    const sampleCell = page.locator('.van-cell').filter({
      has: page.locator('.van-cell__title').getByText(sample.roomNo, { exact: true }),
    }).first();
    await expect(sampleCell).toContainText(`空置${sample.vacantDays}天`);
  });

  test('2.8.2 到期提醒记录跳转对应租约详情', async ({ page }) => {
    const responsePromise = waitForApi(page, 'GET', '/dashboard/expiring');
    await login(page, '/dashboard/expiring');
    const leases = await pageApiResult<ExpiringLease[]>(await responsePromise);
    expect(leases.length, '当前 dev 应至少有一条到期提醒').toBeGreaterThan(0);

    const first = leases[0];
    const cell = page.locator('.van-cell').filter({ hasText: first.tenant?.name ?? '' }).first();
    await expect(cell).toContainText(first.endDate.split('T')[0]);
    await expect(cell).toContainText(`${first.daysLeft}天后到期`);
    await cell.click();
    await expect(page).toHaveURL(new RegExp(`/leases/${first.id}$`));
    await expect(page.locator('.van-nav-bar__title')).toHaveText('租约详情');
  });

  test('2.8.3 逾期账单按楼栋分组且天数金额正确', async ({ page }) => {
    const responsePromise = waitForApi(page, 'GET', '/dashboard/overdue');
    await login(page, '/dashboard/overdue');
    const board = await pageApiResult<OverdueBoard>(await responsePromise);

    await expect(page.locator('.van-cell').filter({ hasText: '逾期总数' }).locator('.van-cell__value')).toHaveText(String(board.total));
    expect(Object.values(board.buildings).flat()).toHaveLength(board.total);
    for (const buildingName of Object.keys(board.buildings)) {
      await expect(page.locator('.van-cell-group__title', { hasText: buildingName })).toBeVisible();
    }

    const sample = Object.values(board.buildings).flat()[0];
    expect(sample, '当前 dev 应至少有一条逾期账单供抽查').toBeTruthy();
    const cell = page.locator('.van-cell').filter({ hasText: `${sample.roomNo} - ${sample.tenantName}` }).first();
    await expect(cell).toContainText(`逾期${sample.overdueDays}天`);
    await expect(cell).toContainText(`¥${sample.amount}`);
    const calculatedDays = Math.floor((Date.now() - new Date(sample.dueDate).getTime()) / 86_400_000);
    expect(Math.abs(sample.overdueDays - calculatedDays)).toBeLessThanOrEqual(1);
  });

  test('2.8.4 空置/逾期条目点击无跳转且空数据页面无空状态组件', async ({ page }, testInfo) => {
    await test.step('真实空置房间条目点击后 URL 不变', async () => {
      await login(page, '/dashboard/vacancy');
      await expect(page.locator('.page-loading')).not.toBeVisible();
      const roomCell = page.locator('.van-cell-group .van-cell').first();
      await expect(roomCell).toBeVisible();
      const before = page.url();
      await roomCell.click();
      await page.waitForTimeout(300);
      expect(page.url()).toBe(before);
    });

    await test.step('真实逾期账单条目点击后 URL 不变', async () => {
      await login(page, '/dashboard/overdue');
      await expect(page.locator('.page-loading')).not.toBeVisible();
      const billCell = page.locator('.van-cell-group .van-cell').first();
      await expect(billCell).toBeVisible();
      const before = page.url();
      await billCell.click();
      await page.waitForTimeout(300);
      expect(page.url()).toBe(before);
    });

    const emptyObservations: Record<string, unknown> = {};
    for (const [path, totalLabel] of [
      ['/dashboard/vacancy', '空置总数'],
      ['/dashboard/overdue', '逾期总数'],
    ] as const) {
      await test.step(`${path} 空响应展示`, async () => {
        await page.route(`**${apiPrefix}${path}`, async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ code: 0, message: 'success', data: { total: 0, buildings: {} } }),
          });
        });
        await login(page, path);
        await expect(page.locator('.page-loading')).not.toBeVisible();
        await expect(page.locator('.van-cell').filter({ hasText: totalLabel }).locator('.van-cell__value')).toHaveText('0');
        const emptyCount = await page.locator('.van-empty').count();
        emptyObservations[path] = { emptyCount, bodyText: (await page.locator('body').innerText()).trim() };
        expect(emptyCount).toBe(0);
        await page.unroute(`**${apiPrefix}${path}`);
      });
    }
    console.log(`OBSERVATION 2.8.4 ${JSON.stringify(emptyObservations)}`);
    testInfo.annotations.push({ type: 'observation', description: JSON.stringify(emptyObservations) });
  });
});

test.describe('2.9 维修管理', () => {
  test('2.9.1 正常新增维修记录并在列表出现', async ({ page }) => {
    test.skip(blockWrites, `检测到同前缀 ${dataPrefix} 的已有记录，避免叠加`);
    const content = `${dataPrefix}_正常维修`;
    const existing = (await landlordGet<MaintenanceRecord[]>('/maintenance')).find((item) => item.content === content);
    if (existing) {
      console.warn(`DIRTY_PREFIX_WARNING 已存在维修记录 id=${existing.id}，不重复创建`);
      await login(page, '/maintenance');
      await expect(page.locator('.van-cell').filter({ hasText: content })).toBeVisible();
      return;
    }

    await login(page, '/maintenance');
    await openAddDialog(page);
    await dialogField(page, '房间ID').fill(String(knownRoomId));
    await dialogField(page, '日期').fill(today);
    await dialogField(page, '内容').fill(content);
    await dialogField(page, '费用').fill('91.25');
    const created = await pageApiResult<MaintenanceRecord>(await submitDialog(page, '/maintenance'));
    expect(created.content).toBe(content);
    await expect(page.locator('.van-toast')).toContainText('已添加');
    await expect(page.locator('.van-cell').filter({ hasText: content })).toContainText('¥91.25');
    expect((await landlordGet<MaintenanceRecord[]>('/maintenance')).some((item) => item.id === created.id)).toBeTruthy();
  });

  test('2.9.2 房间ID/日期/内容分别留空时记录真实后端响应', async ({ page }, testInfo) => {
    test.skip(blockWrites, `检测到同前缀 ${dataPrefix} 的已有记录，避免叠加`);
    const observations: Record<string, unknown> = {};
    const cases = [
      { key: 'roomId', roomId: '', date: today, content: `${dataPrefix}_缺房间`, cost: '92.01' },
      { key: 'date', roomId: String(knownRoomId), date: '', content: `${dataPrefix}_缺日期`, cost: '92.02' },
      { key: 'content', roomId: String(knownRoomId), date: today, content: '', cost: '92.03' },
    ];

    for (const item of cases) {
      await test.step(`${item.key} 留空`, async () => {
        const beforeRecords = await landlordGet<MaintenanceRecord[]>('/maintenance');
        const existingMatches = beforeRecords.filter((record) =>
          record.roomId === knownRoomId
          && record.date.startsWith(today)
          && Number(record.cost) === Number(item.cost)
          && record.content === item.content);
        if (existingMatches.length > 0) {
          observations[item.key] = {
            status: 201,
            message: 'success',
            createdCount: existingMatches.length,
            reusedExisting: true,
          };
          expect(item.key).toBe('content');
          expect(existingMatches).toHaveLength(1);
          return;
        }

        await login(page, '/maintenance');
        await openAddDialog(page);
        await dialogField(page, '房间ID').fill(item.roomId);
        await dialogField(page, '日期').fill(item.date);
        await dialogField(page, '内容').fill(item.content);
        await dialogField(page, '费用').fill(item.cost);
        const response = await submitDialog(page, '/maintenance');
        const observation = await responseObservation(response);
        await page.waitForTimeout(250);
        const records = await landlordGet<MaintenanceRecord[]>('/maintenance');
        const createdMatches = records.filter((record) =>
          record.roomId === knownRoomId
          && record.date.startsWith(today)
          && Number(record.cost) === Number(item.cost)
          && record.content === item.content);
        observations[item.key] = { ...observation, createdCount: createdMatches.length };
        if (item.key === 'roomId') {
          expect(observation.status).toBe(400);
          expect(observation.message).toContain('房间必须为整数');
        } else if (item.key === 'date') {
          expect(observation.status).toBe(400);
          expect(observation.message).toContain('日期格式不正确');
        } else {
          expect(observation.status).toBe(201);
          expect(createdMatches).toHaveLength(1);
        }
      });
    }
    console.log(`OBSERVATION 2.9.2 ${JSON.stringify(observations)}`);
    testInfo.annotations.push({ type: 'observation', description: JSON.stringify(observations) });
  });

  test('2.9.3 不存在房间ID的响应及脏数据检查', async ({ page }, testInfo) => {
    test.skip(blockWrites, `检测到同前缀 ${dataPrefix} 的已有记录，避免叠加`);
    const content = `${dataPrefix}_不存在房间`;
    const impossibleRoomId = 999_999_999;
    await login(page, '/maintenance');
    await openAddDialog(page);
    await dialogField(page, '房间ID').fill(String(impossibleRoomId));
    await dialogField(page, '日期').fill(today);
    await dialogField(page, '内容').fill(content);
    await dialogField(page, '费用').fill('93.03');
    const response = await submitDialog(page, '/maintenance');
    const responseInfo = await responseObservation(response);
    await page.waitForTimeout(250);
    const matches = (await landlordGet<MaintenanceRecord[]>('/maintenance')).filter((item) => item.content === content);
    const observation = { impossibleRoomId, ...responseInfo, createdCount: matches.length, createdIds: matches.map((item) => item.id) };
    console.log(`OBSERVATION 2.9.3 ${JSON.stringify(observation)}`);
    testInfo.annotations.push({ type: 'observation', description: JSON.stringify(observation) });
    expect(response.ok()).toBeFalsy();
    expect(matches).toHaveLength(0);
  });

  test('2.9.4 房间ID字段为纯数字输入而非选择器', async ({ page }) => {
    await login(page, '/maintenance');
    await openAddDialog(page);
    const field = dialogField(page, '房间ID');
    await expect(field).toHaveAttribute('type', 'text');
    await expect(field).toHaveAttribute('inputmode', 'decimal');
    await expect(visibleDialog(page).locator('.van-picker')).toHaveCount(0);
    await expect(visibleDialog(page).locator('.van-field').filter({ hasText: '房间ID' })).not.toHaveClass(/van-field--clickable/);
  });
});

test.describe('2.10 支出管理', () => {
  test('2.10.1 正常新增支出并在列表出现', async ({ page }) => {
    test.skip(blockWrites, `检测到同前缀 ${dataPrefix} 的已有记录，避免叠加`);
    const name = `${dataPrefix}_正常支出`;
    const remark = `${dataPrefix}_正常支出备注`;
    const existing = (await landlordGet<ExpenseRecord[]>('/expenses')).find((item) => item.remark === remark);
    if (existing) {
      console.warn(`DIRTY_PREFIX_WARNING 已存在支出记录 id=${existing.id}，不重复创建`);
      await login(page, '/expenses');
      await expect(page.locator('.van-cell').filter({ hasText: name })).toBeVisible();
      return;
    }

    await login(page, '/expenses');
    await openAddDialog(page);
    await dialogField(page, '日期').fill(today);
    await dialogField(page, '类目').fill(`${dataPrefix}_测试类目`);
    await dialogField(page, '名称').fill(name);
    await dialogField(page, '金额').fill('101.25');
    await dialogField(page, '备注').fill(remark);
    const created = await pageApiResult<ExpenseRecord>(await submitDialog(page, '/expenses'));
    expect(created.remark).toBe(remark);
    await expect(page.locator('.van-toast')).toContainText('已添加');
    await expect(page.locator('.van-cell').filter({ hasText: name })).toContainText('¥101.25');
  });

  test('2.10.2 日期/类目/名称/金额分别留空时记录真实后端响应', async ({ page }, testInfo) => {
    test.skip(blockWrites, `检测到同前缀 ${dataPrefix} 的已有记录，避免叠加`);
    const observations: Record<string, unknown> = {};
    const cases = [
      { key: 'date', date: '', category: `${dataPrefix}_缺日期类目`, name: `${dataPrefix}_缺日期`, amount: '102.01' },
      { key: 'category', date: today, category: '', name: `${dataPrefix}_缺类目`, amount: '102.02' },
      { key: 'name', date: today, category: `${dataPrefix}_缺名称类目`, name: '', amount: '102.03' },
      { key: 'amount', date: today, category: `${dataPrefix}_缺金额类目`, name: `${dataPrefix}_缺金额`, amount: '' },
    ];

    for (const item of cases) {
      const remark = `${dataPrefix}_边界_${item.key}`;
      await test.step(`${item.key} 留空`, async () => {
        const existingMatches = (await landlordGet<ExpenseRecord[]>('/expenses'))
          .filter((record) => record.remark === remark);
        if (existingMatches.length > 0) {
          observations[item.key] = {
            status: 201,
            message: 'success',
            createdCount: existingMatches.length,
            reusedExisting: true,
          };
          expect(['category', 'name']).toContain(item.key);
          expect(existingMatches).toHaveLength(1);
          return;
        }

        await login(page, '/expenses');
        await openAddDialog(page);
        await dialogField(page, '日期').fill(item.date);
        await dialogField(page, '类目').fill(item.category);
        await dialogField(page, '名称').fill(item.name);
        await dialogField(page, '金额').fill(item.amount);
        await dialogField(page, '备注').fill(remark);
        const response = await submitDialog(page, '/expenses');
        const observation = await responseObservation(response);
        await page.waitForTimeout(250);
        const matches = (await landlordGet<ExpenseRecord[]>('/expenses')).filter((record) => record.remark === remark);
        observations[item.key] = { ...observation, createdCount: matches.length };
        if (item.key === 'date') {
          expect(observation.status).toBe(400);
          expect(observation.message).toContain('日期格式不正确');
        } else if (item.key === 'amount') {
          expect(observation.status).toBe(400);
          expect(observation.message).toContain('金额不能小于最小值');
        } else {
          expect(observation.status).toBe(201);
          expect(matches).toHaveLength(1);
        }
      });
    }
    console.log(`OBSERVATION 2.10.2 ${JSON.stringify(observations)}`);
    testInfo.annotations.push({ type: 'observation', description: JSON.stringify(observations) });
  });

  test('2.10.3 列表没有编辑或删除入口', async ({ page }) => {
    await login(page, '/expenses');
    await expect(page.locator('.page-loading')).not.toBeVisible();
    await expect(page.getByRole('button', { name: /编辑|删除/ })).toHaveCount(0);
    await expect(page.locator('.van-swipe-cell')).toHaveCount(0);
    await expect(page.locator('.van-cell').filter({ hasText: `${dataPrefix}_正常支出` }).first()).toBeVisible();
  });
});

test.describe('2.11 报表', () => {
  test('2.11.1 有数据月份各区块与接口数据一致', async ({ page }) => {
    await login(page, '/reports');
    await expect(page.locator('.page-loading')).not.toBeVisible({ timeout: 30_000 });
    const reportResponse = await setReportMonth(page, reportMonth);
    const report = await pageApiResult<MonthlyReport>(reportResponse);
    const deposit = await landlordGet<DepositSummary>('/dashboard/reports/deposit-summary');
    await expect(page.locator('.page-loading')).not.toBeVisible({ timeout: 30_000 });

    expect(report.receivable).toBeGreaterThan(0);
    const expectedCells: Array<[string, string]> = [
      ['应收', `¥${report.receivable}`],
      ['实收', `¥${report.received}`],
      ['收缴率', `${report.collectionRate}%`],
      ['净收益', `¥${report.netIncome}`],
      ['支出合计', `¥${report.expense.total}`],
      ['空置率', `${report.vacancy.vacancyRate}%`],
      ['空置房数', String(report.vacancy.vacantRooms)],
      ['空置损失估算', `¥${report.vacancy.estimatedLoss}`],
      ['累计收取', `¥${deposit.totalReceived}`],
      ['累计退还', `¥${deposit.totalRefunded}`],
      ['累计扣除', `¥${deposit.totalDeducted}`],
      ['当前结余', `¥${deposit.currentBalance}`],
    ];
    for (const [title, value] of expectedCells) {
      await expect(page.locator('.van-cell').filter({ hasText: title }).first().locator('.van-cell__value')).toHaveText(value);
    }
    for (const [buildingName, values] of Object.entries(report.byBuilding)) {
      await expect(page.locator('.van-cell').filter({ hasText: buildingName }).first())
        .toContainText(`应收¥${values.receivable} / 实收¥${values.received} / ${values.rate}%`);
    }
    for (const [category, amount] of Object.entries(report.expense.byCategory)) {
      if (category) {
        await expect(page.locator('.van-cell').filter({ hasText: category }).first()).toContainText(`¥${amount}`);
      } else {
        await expect(page.locator('.van-cell__value').getByText(`¥${amount}`, { exact: true })).toBeVisible();
      }
    }
    await expect(pageHasInvalidNumberText(page)).toHaveCount(0);
  });

  test('2.11.2 月份输入 abc/2026-13/空字符串时记录页面实际表现', async ({ page }, testInfo) => {
    await login(page, '/reports');
    await expect(page.locator('.page-loading')).not.toBeVisible({ timeout: 30_000 });
    const observations: Record<string, unknown> = {};

    for (const value of ['abc', '2026-13', '']) {
      await test.step(`月份=${JSON.stringify(value)}`, async () => {
        // 每种非法输入从独立页面状态开始，避免前一种输入的 toast 节点串场。
        await login(page, '/reports');
        await expect(page.locator('.page-loading')).not.toBeVisible({ timeout: 30_000 });
        const response = await setReportMonth(page, value);
        const info = await responseObservation(response);
        const responseBody = (await response.json()) as Partial<ApiEnvelope<MonthlyReport>>;
        await expect(page.locator('.page-loading')).not.toBeVisible({ timeout: 30_000 });
        const bodyText = await page.locator('body').innerText();
        const toastText = await page.locator('.van-toast').count()
          ? await page.locator('.van-toast').last().innerText()
          : '';
        observations[value || '<empty>'] = {
          ...info,
          responseMonth: responseBody.data?.month,
          receivable: responseBody.data?.receivable,
          received: responseBody.data?.received,
          url: page.url(),
          bodyVisible: await page.locator('body').isVisible(),
          reportStillVisible: bodyText.includes('收入概览'),
          toastText,
          containsInvalidNumberText: /NaN|undefined|null/.test(bodyText),
        };
        await expect(page.locator('body')).toBeVisible();
        if (await page.locator('.van-toast').count()) {
          await expect(page.locator('.van-toast').last()).not.toBeVisible({ timeout: 5_000 });
        }
      });
    }
    console.log(`OBSERVATION 2.11.2 ${JSON.stringify(observations)}`);
    testInfo.annotations.push({ type: 'observation', description: JSON.stringify(observations) });
  });

  test('2.11.3 无账单月份各区块展示零值且无异常文本', async ({ page }, testInfo) => {
    await login(page, '/reports');
    await expect(page.locator('.page-loading')).not.toBeVisible({ timeout: 30_000 });
    const response = await setReportMonth(page, '2099-01');
    const report = await pageApiResult<MonthlyReport>(response);
    await expect(page.locator('.page-loading')).not.toBeVisible({ timeout: 30_000 });

    expect(report.receivable).toBe(0);
    expect(report.received).toBe(0);
    expect(report.collectionRate).toBe(0);
    expect(Object.keys(report.byBuilding)).toHaveLength(0);
    await expect(page.locator('.van-cell').filter({ hasText: '应收' }).first().locator('.van-cell__value')).toHaveText('¥0');
    await expect(page.locator('.van-cell').filter({ hasText: '实收' }).first().locator('.van-cell__value')).toHaveText('¥0');
    await expect(page.locator('.van-cell').filter({ hasText: '收缴率' }).first().locator('.van-cell__value')).toHaveText('0%');
    await expect(pageHasInvalidNumberText(page)).toHaveCount(0);
    const emptyCount = await page.locator('.van-empty').count();
    const observation = {
      report,
      emptyStateCount: emptyCount,
      sections: await page.locator('.van-cell-group__title').allTextContents(),
    };
    console.log(`OBSERVATION 2.11.3 ${JSON.stringify(observation)}`);
    testInfo.annotations.push({ type: 'observation', description: JSON.stringify(observation) });
  });
});
