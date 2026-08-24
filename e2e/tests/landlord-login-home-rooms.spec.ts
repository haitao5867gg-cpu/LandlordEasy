import { expect, test, type Page, type Response } from '@playwright/test';

const apiPrefix = '/api/v1';
const runId = Date.now().toString().slice(-8);
const dataPrefix = `E2E_QA_${runId}`;
const expectedBuildings = ['Q栋', 'R栋', 'S栋', '明远公寓'];

let createdBuildingId = 0;
let createdBuildingName = '';
let createdRoomNos: string[] = [];
let createdLeaseId = 0;
let cachedLandlordToken = '';

interface ApiEnvelope<T> {
  code: number;
  message?: string;
  data: T;
}

interface Building {
  id: number;
  name: string;
}

interface RoomSummary {
  id: number;
  buildingId: number;
  roomNo: string;
  status: string;
  building: Building;
}

interface RoomDetail extends RoomSummary {
  leases: Array<any>;
  maintenanceRecords: Array<any>;
  expenses: Array<any>;
  auditLogs: Array<any>;
}

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

async function apiData<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(response.ok(), `${response.request().method()} ${response.url()}: ${body.message ?? ''}`).toBeTruthy();
  expect(body.code).toBe(0);
  return body.data;
}

async function authenticatedGet<T>(page: Page, pathname: string): Promise<T> {
  const token = await page.evaluate(() => localStorage.getItem('landlord_token'));
  expect(token, '登录 token 应存在').toBeTruthy();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await page.request.get(`${apiPrefix}${pathname}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status() === 429 && attempt < 4) {
      await page.waitForTimeout(1_500 * (attempt + 1));
      continue;
    }
    const body = (await response.json()) as ApiEnvelope<T>;
    expect(response.ok(), `GET ${pathname}: ${body.message ?? ''}`).toBeTruthy();
    expect(body.code).toBe(0);
    return body.data;
  }
  throw new Error(`GET ${pathname} 多次触发限流`);
}

async function login(page: Page): Promise<void> {
  if (cachedLandlordToken) {
    await page.addInitScript((token) => localStorage.setItem('landlord_token', token), cachedLandlordToken);
    await page.goto('/');
  } else {
    await page.goto('/login?mock_openid=mock_landlord_001');
    await expect(page).toHaveURL('https://dev.landlordeasy.cn/');
    cachedLandlordToken = (await page.evaluate(() => localStorage.getItem('landlord_token'))) ?? '';
  }
  await expect(page).toHaveURL('https://dev.landlordeasy.cn/');
  await expect(page.locator('.van-tabbar')).toBeVisible();
}

function fieldInput(page: Page, label: string) {
  return page.locator('.van-field').filter({ hasText: label }).locator('input').first();
}

function roomCells(page: Page) {
  return page.locator('.room-list-page > .van-cell-group .van-cell');
}

function roomCell(page: Page, roomNo: string) {
  return roomCells(page).filter({ hasText: roomNo }).first();
}

async function openRooms(page: Page): Promise<void> {
  const buildingsResponse = waitForApi(page, 'GET', '/buildings');
  const roomsResponse = waitForApi(page, 'GET', '/rooms');
  await page.goto('/rooms');
  await apiData(await buildingsResponse);
  await apiData(await roomsResponse);
  await expect(page.locator('.van-nav-bar__title')).toHaveText('房间管理');
}

async function clickRoomFilter(
  page: Page,
  buildingName: string,
  statusLabel: string,
  status: string,
  buildingId: number,
): Promise<RoomSummary[]> {
  const buildingRequest = waitForApi(page, 'GET', '/rooms', undefined);
  await page.locator('.van-tabs').nth(0).getByRole('tab', { name: buildingName, exact: true }).click();
  await apiData(await buildingRequest);

  const finalRequest = waitForApi(page, 'GET', '/rooms', {
    buildingId: String(buildingId),
    ...(status ? { status } : {}),
  });
  await page.locator('.van-tabs').nth(1).getByRole('tab', { name: statusLabel, exact: true }).click();
  return apiData<RoomSummary[]>(await finalRequest);
}

async function openBatchCreate(page: Page): Promise<void> {
  await page.locator('.van-nav-bar__right .van-icon-plus').click();
  await expect(page).toHaveURL(/\/rooms\/batch-create$/);
  await expect(page.locator('.van-nav-bar__title')).toHaveText('批量建房');
}

async function choosePickerValue(page: Page, fieldLabel: string, value: string): Promise<void> {
  await page.locator('.van-field').filter({ hasText: fieldLabel }).click();
  const popup = page.locator('.van-popup--bottom:visible');
  await expect(popup).toBeVisible();
  await popup.getByText(value, { exact: true }).click();
  await popup.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByRole('textbox', { name: fieldLabel, exact: true })).toHaveValue(value);
}

async function fillBatchForm(
  page: Page,
  buildingName: string,
  startRoom: string,
  endRoom = '',
  roomTypeName?: string,
): Promise<void> {
  await choosePickerValue(page, '楼栋', buildingName);
  if (roomTypeName) await choosePickerValue(page, '房型(可选)', roomTypeName);
  await fieldInput(page, '起始房号').fill(startRoom);
  if (endRoom) await fieldInput(page, '结束房号').fill(endRoom);
}

function dateString(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

test.describe('2.1 登录', () => {
  test('2.1.1 mock openid 自动登录并跳转工作台', async ({ page }) => {
    const loginResponse = waitForApi(page, 'POST', '/auth/landlord/login');
    await page.goto('/login?mock_openid=mock_landlord_001');
    await apiData(await loginResponse);
    await expect(page).toHaveURL('https://dev.landlordeasy.cn/');
    cachedLandlordToken = (await page.evaluate(() => localStorage.getItem('landlord_token'))) ?? '';
    expect(cachedLandlordToken).not.toBe('');
    await expect(page.locator('.van-nav-bar__title')).toHaveText('工作台');
  });

  test('2.1.2 OpenID 留空提示且点击不新增登录请求', async ({ page }) => {
    let loginRequestCount = 0;
    await page.route('**/api/v1/auth/landlord/login', async (route) => {
      loginRequestCount += 1;
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ code: 401, message: '测试前置拦截' }),
      });
    });
    await page.goto('/login?mock_openid=E2E_QA_manual_mode');
    await expect(page.getByPlaceholder('输入 mock_openid')).toBeVisible();
    await expect.poll(() => loginRequestCount).toBe(1);
    await fieldInput(page, 'OpenID').fill('');
    const beforeClick = loginRequestCount;
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.locator('.van-toast')).toContainText('请输入 OpenID');
    await page.waitForTimeout(500);
    expect(loginRequestCount).toBe(beforeClick);
  });

  test('2.1.3 不存在的 openid 返回清晰中文提示', async ({ page }) => {
    const responsePromise = waitForApi(page, 'POST', '/auth/landlord/login');
    await page.goto(`/login?mock_openid=${dataPrefix}_missing`);
    const response = await responsePromise;
    expect(response.status()).toBe(401);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toMatch(/[\u4e00-\u9fff]/);
    expect(body.message).not.toMatch(/Unauthorized|Exception|stack|Prisma/i);
    await expect(page.locator('.van-toast')).toContainText(body.message ?? '');
  });

  test('2.1.4 已登录直接访问 /rooms 不重定向', async ({ page }) => {
    await login(page);
    await page.goto('/rooms');
    await expect(page).toHaveURL(/\/rooms$/);
    await expect(page.locator('.van-nav-bar__title')).toHaveText('房间管理');
  });

  test('2.1.5 无效 token 访问保护页跳登录并提示过期', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('landlord_token', 'E2E_QA_expired_token'));
    await page.goto('/rooms');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('.van-toast')).toContainText('登录已过期,请重新登录');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('landlord_token'))).toBeNull();
  });
});

test.describe('2.2 工作台', () => {
  test('2.2.1 四张卡片数字与四个接口一致', async ({ page }) => {
    const vacancyPromise = waitForApi(page, 'GET', '/dashboard/vacancy');
    const expiringPromise = waitForApi(page, 'GET', '/dashboard/expiring');
    const overduePromise = waitForApi(page, 'GET', '/dashboard/overdue');
    const pendingPromise = waitForApi(page, 'GET', '/payments/pending');
    await login(page);

    const [vacancy, expiring, overdue, pending] = await Promise.all([
      apiData<{ total: number }>(await vacancyPromise),
      apiData<any[]>(await expiringPromise),
      apiData<{ total: number }>(await overduePromise),
      apiData<any[]>(await pendingPromise),
    ]);
    const expected = new Map<string, number>([
      ['空置房间', vacancy.total],
      ['30天内到期', expiring.length],
      ['逾期账单', overdue.total],
      ['待确认收款', pending.length],
    ]);
    const cards = page.locator('.dashboard-cards .van-cell');
    await expect(cards).toHaveCount(4);
    for (const [title, count] of expected) {
      await expect(cards.filter({ hasText: title }).locator('.van-cell__value')).toHaveText(String(count));
    }
  });

  test('2.2.2 四张卡片跳转到对应页面', async ({ page }) => {
    await login(page);
    const routes: Array<[string, string]> = [
      ['空置房间', '/dashboard/vacancy'],
      ['30天内到期', '/dashboard/expiring'],
      ['逾期账单', '/dashboard/overdue'],
      ['待确认收款', '/payments/pending'],
    ];
    for (const [title, pathname] of routes) {
      await page.goto('/');
      await expect(page.locator('.dashboard-cards')).toBeVisible();
      await page.locator('.dashboard-cards .van-cell').filter({ hasText: title }).click();
      await expect(page).toHaveURL(new RegExp(`${pathname.replaceAll('/', '\\/')}$`));
    }
  });

  test('2.2.3 overdue 接口 500 时记录其余三张卡片的实际表现', async ({ page }, testInfo) => {
    await page.route('**/api/v1/dashboard/overdue', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ code: 500, message: 'E2E_QA_模拟逾期接口失败' }),
      });
    });
    const vacancyPromise = waitForApi(page, 'GET', '/dashboard/vacancy');
    const expiringPromise = waitForApi(page, 'GET', '/dashboard/expiring');
    const pendingPromise = waitForApi(page, 'GET', '/payments/pending');
    await login(page);
    const [vacancy, expiring, pending] = await Promise.all([
      apiData<{ total: number }>(await vacancyPromise),
      apiData<any[]>(await expiringPromise),
      apiData<any[]>(await pendingPromise),
    ]);
    await expect(page.locator('.page-loading')).not.toBeVisible();
    const observed: Record<string, string> = {};
    for (const title of ['空置房间', '30天内到期', '逾期账单', '待确认收款']) {
      const card = page.locator('.dashboard-cards .van-cell').filter({ hasText: title });
      observed[title] = (await card.locator('.van-cell__value').textContent())?.trim() ?? '<未显示>';
    }
    const expectedSuccessfulValues = {
      空置房间: String(vacancy.total),
      '30天内到期': String(expiring.length),
      待确认收款: String(pending.length),
    };
    const observation = { successfulApiValues: expectedSuccessfulValues, displayedCardValues: observed };
    console.log(`OBSERVATION 2.2.3 ${JSON.stringify(observation)}`);
    testInfo.annotations.push({ type: 'observation', description: JSON.stringify(observation) });
    await testInfo.attach('2.2.3-observation.json', {
      body: Buffer.from(JSON.stringify(observation, null, 2)),
      contentType: 'application/json',
    });
    await expect(page.locator('.dashboard-cards .van-cell')).toHaveCount(4);
  });

  test('2.2.4 底部四个 tabbar 入口跳转且高亮', async ({ page }) => {
    await login(page);
    const tabs: Array<[string, string]> = [
      ['工作台', '/'],
      ['房间', '/rooms'],
      ['账单', '/bills'],
      ['我的', '/mine'],
    ];
    for (const [label, pathname] of tabs) {
      const item = page.locator('.van-tabbar-item').filter({ hasText: label });
      await item.click();
      const expectedUrl = pathname === '/' ? 'https://dev.landlordeasy.cn/' : new RegExp(`${pathname.replaceAll('/', '\\/')}$`);
      await expect(page).toHaveURL(expectedUrl);
      await expect(item).toHaveClass(/van-tabbar-item--active/);
    }
  });
});

test.describe('2.3 房间管理', () => {
  test('2.3.1 楼栋与状态组合筛选至少三组且结果一致', async ({ page }) => {
    await login(page);
    await openRooms(page);
    const buildings = await authenticatedGet<Building[]>(page, '/buildings');
    for (const name of expectedBuildings) {
      await expect(page.locator('.van-tabs').nth(0).getByRole('tab', { name, exact: true })).toBeVisible();
    }
    const buildingByName = new Map(buildings.map((building) => [building.name, building]));
    const combinations: Array<[string, string, string]> = [
      ['Q栋', '空置', 'VACANT'],
      ['R栋', '已租', 'RENTED'],
      ['S栋', '维修中', 'MAINTENANCE'],
    ];
    for (const [buildingName, statusLabel, status] of combinations) {
      const building = buildingByName.get(buildingName);
      expect(building, `应存在楼栋 ${buildingName}`).toBeTruthy();
      const rooms = await clickRoomFilter(page, buildingName, statusLabel, status, building!.id);
      expect(rooms.every((room) => room.buildingId === building!.id && room.status === status)).toBeTruthy();
      if (rooms.length === 0) {
        await expect(page.getByText('暂无房间', { exact: true })).toBeVisible();
      } else {
        await expect(roomCells(page)).toHaveCount(rooms.length);
        await expect(roomCells(page).locator('.van-tag')).toHaveText(Array(rooms.length).fill(statusLabel));
      }
    }
  });

  test('2.3.2 无数据组合显示“暂无房间”', async ({ page }) => {
    await login(page);
    await openRooms(page);
    const [buildings, rooms] = await Promise.all([
      authenticatedGet<Building[]>(page, '/buildings'),
      authenticatedGet<RoomSummary[]>(page, '/rooms'),
    ]);
    const statuses = ['MAINTENANCE', 'RENTED', 'VACANT'];
    const empty = buildings.flatMap((building) =>
      statuses.map((status) => ({ building, status })),
    ).find(({ building, status }) =>
      !rooms.some((room) => room.buildingId === building.id && room.status === status),
    );
    expect(empty, 'dev 数据中应至少有一个楼栋+状态空组合').toBeTruthy();
    const label = { MAINTENANCE: '维修中', RENTED: '已租', VACANT: '空置' }[empty!.status]!;
    const result = await clickRoomFilter(page, empty!.building.name, label, empty!.status, empty!.building.id);
    expect(result).toHaveLength(0);
    await expect(page.getByText('暂无房间', { exact: true })).toBeVisible();
    await expect(page.locator('.room-list-page')).toBeVisible();
  });

  test('2.3.3 从详情返回后保留楼栋与状态筛选', async ({ page }) => {
    await login(page);
    await openRooms(page);
    const [buildings, rooms] = await Promise.all([
      authenticatedGet<Building[]>(page, '/buildings'),
      authenticatedGet<RoomSummary[]>(page, '/rooms'),
    ]);
    const candidate = rooms.find((room) => room.status === 'VACANT') ?? rooms[0];
    expect(candidate, '应至少有一个房间').toBeTruthy();
    const building = buildings.find((item) => item.id === candidate.buildingId)!;
    const statusLabel = candidate.status === 'VACANT' ? '空置' : candidate.status === 'RENTED' ? '已租' : '维修中';
    await clickRoomFilter(page, building.name, statusLabel, candidate.status, building.id);
    await roomCell(page, candidate.roomNo).click();
    await expect(page).toHaveURL(new RegExp(`/rooms/${candidate.id}$`));
    await page.locator('.van-nav-bar__left').click();
    await expect(page).toHaveURL(/\/rooms$/);
    await expect(page.locator('.van-tabs').nth(0).locator('.van-tab--active')).toContainText(building.name);
    await expect(page.locator('.van-tabs').nth(1).locator('.van-tab--active')).toContainText(statusLabel);
    await expect(roomCell(page, candidate.roomNo)).toBeVisible();
  });

  test('2.3.4 批量建房选择器、单间、完全重复、部分重复完整回归', async ({ page }) => {
    await login(page);
    await openRooms(page);
    const [buildings, roomTypes, existingRooms] = await Promise.all([
      authenticatedGet<Building[]>(page, '/buildings'),
      authenticatedGet<Array<{ id: number; name: string }>>(page, '/room-types'),
      authenticatedGet<RoomSummary[]>(page, '/rooms'),
    ]);
    expect(buildings.length).toBeGreaterThan(0);
    expect(roomTypes.length).toBeGreaterThan(0);
    const building = buildings.find((item) => expectedBuildings.includes(item.name)) ?? buildings[0];
    const used = new Set(existingRooms.filter((room) => room.buildingId === building.id).map((room) => Number(room.roomNo)));
    let start = 900;
    while (start < 999 && (used.has(start) || used.has(start + 1))) start += 1;
    expect(start, '9xx 高位房号段应有两个连续空号').toBeLessThan(999);
    createdBuildingId = building.id;
    createdBuildingName = building.name;
    createdRoomNos = [String(start), String(start + 1)];

    await openBatchCreate(page);
    await fillBatchForm(page, building.name, createdRoomNos[0], '', roomTypes[0].name);
    const singleResponsePromise = waitForApi(page, 'POST', '/rooms/batch');
    await page.getByRole('button', { name: '提交', exact: true }).click();
    const single = await apiData<{ created: number; skipped: string[] }>(await singleResponsePromise);
    expect(single.created).toBe(1);
    expect(single.skipped).toEqual([]);
    await expect(page.locator('.van-toast')).toContainText('成功创建 1 间房');
    await expect(page).toHaveURL(/\/rooms$/);

    await openBatchCreate(page);
    await fillBatchForm(page, building.name, createdRoomNos[0]);
    const duplicateResponsePromise = waitForApi(page, 'POST', '/rooms/batch');
    await page.getByRole('button', { name: '提交', exact: true }).click();
    const duplicateResponse = await duplicateResponsePromise;
    expect(duplicateResponse.status()).toBe(400);
    const duplicateBody = (await duplicateResponse.json()) as { message?: string };
    expect(duplicateBody.message).toContain('均已存在');
    await expect(page.locator('.van-toast')).toContainText('均已存在');
    await page.locator('.van-nav-bar__left').click();
    await expect(page).toHaveURL(/\/rooms$/);

    await openBatchCreate(page);
    await fillBatchForm(page, building.name, createdRoomNos[0], createdRoomNos[1]);
    const partialResponsePromise = waitForApi(page, 'POST', '/rooms/batch');
    await page.getByRole('button', { name: '提交', exact: true }).click();
    const partial = await apiData<{ created: number; skipped: string[] }>(await partialResponsePromise);
    expect(partial.created).toBe(1);
    expect(partial.skipped).toEqual([createdRoomNos[0]]);
    await expect(page.locator('.van-toast')).toContainText(`房号${createdRoomNos[0]}已存在未创建`);
    await expect(page).toHaveURL(/\/rooms$/);
  });

  test('2.3.5 新签和退租返回列表时记录未刷新前的状态', async ({ page }, testInfo) => {
    expect(createdBuildingId, '2.3.4 应先创建测试房间').toBeGreaterThan(0);
    expect(createdRoomNos.length).toBe(2);
    const targetRoomNo = createdRoomNos[0];
    await login(page);
    await openRooms(page);
    const targetRoomsPromise = waitForApi(page, 'GET', '/rooms', { buildingId: String(createdBuildingId) });
    await page.locator('.van-tabs').nth(0).getByRole('tab', { name: createdBuildingName, exact: true }).click();
    await apiData(await targetRoomsPromise);
    const targetCell = roomCell(page, targetRoomNo);
    await expect(targetCell).toBeVisible();
    const beforeSign = (await targetCell.locator('.van-tag').textContent())?.trim() ?? '<未显示>';
    await targetCell.click();
    await page.getByRole('button', { name: '新签租约' }).click();
    await fieldInput(page, '姓名').fill(`${dataPrefix}_租客`);
    await fieldInput(page, '手机号').fill(`139${runId}`);
    await fieldInput(page, '月租金').fill('1357');
    await fieldInput(page, '押金').fill('1357');
    const leaseResponsePromise = waitForApi(page, 'POST', '/leases');
    await page.getByRole('button', { name: '确认签约' }).click();
    const lease = await apiData<{ id: number; inviteCode: string }>(await leaseResponsePromise);
    createdLeaseId = lease.id;
    await expect(page.locator('.van-dialog').filter({ hasText: '签约成功' })).toBeVisible();
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await page.locator('.van-nav-bar__left').click();
    await expect(page).toHaveURL(new RegExp(`/rooms/\\d+$`));
    await page.locator('.van-nav-bar__left').click();
    await expect(page).toHaveURL(/\/rooms$/);
    const afterSignWithoutRefresh = (await roomCell(page, targetRoomNo).locator('.van-tag').textContent())?.trim() ?? '<未显示>';

    const roomsReloadPromise = waitForApi(page, 'GET', '/rooms');
    await page.reload();
    await apiData(await roomsReloadPromise);
    await expect(roomCell(page, targetRoomNo).locator('.van-tag')).toHaveText('已租');
    await roomCell(page, targetRoomNo).click();
    await page.locator('.van-cell').filter({ hasText: `${dataPrefix}_租客` }).click();
    await expect(page).toHaveURL(new RegExp(`/leases/${createdLeaseId}$`));
    await page.getByRole('button', { name: '退租', exact: true }).click();
    const endDialog = page.locator('.van-dialog:visible');
    await endDialog.locator('.van-field').filter({ hasText: '退租日' }).locator('input').fill(dateString());
    await endDialog.locator('.van-field').filter({ hasText: '退还押金' }).locator('input').fill('0');
    const endResponsePromise = waitForApi(page, 'POST', `/leases/${createdLeaseId}/end`);
    await endDialog.getByRole('button', { name: '确认', exact: true }).click();
    await apiData(await endResponsePromise);
    await expect(page).toHaveURL(new RegExp(`/rooms/\\d+$`));
    await page.locator('.van-nav-bar__left').click();
    await expect(page).toHaveURL(/\/rooms$/);
    const afterEndWithoutRefresh = (await roomCell(page, targetRoomNo).locator('.van-tag').textContent())?.trim() ?? '<未显示>';

    const observation = { roomNo: targetRoomNo, beforeSign, afterSignWithoutRefresh, beforeEnd: '已租', afterEndWithoutRefresh };
    console.log(`OBSERVATION 2.3.5 ${JSON.stringify(observation)}`);
    testInfo.annotations.push({ type: 'observation', description: JSON.stringify(observation) });
    await testInfo.attach('2.3.5-observation.json', {
      body: Buffer.from(JSON.stringify(observation, null, 2)),
      contentType: 'application/json',
    });
  });

  test('2.3.6 当前欠费与账单汇总一致，已付清房间不显示欠费', async ({ page }) => {
    await login(page);
    const bills = await authenticatedGet<Array<any>>(page, '/bills');
    const activeBills = bills.filter((bill) => bill.lease?.status === 'ACTIVE');
    const byRoom = new Map<number, any[]>();
    for (const bill of activeBills) {
      const roomId = bill.lease.room.id as number;
      byRoom.set(roomId, [...(byRoom.get(roomId) ?? []), bill]);
    }
    const debtEntry = [...byRoom.entries()].find(([, roomBills]) =>
      roomBills.some((bill) => ['PENDING', 'OVERDUE'].includes(bill.status)),
    );
    const paidEntry = [...byRoom.entries()].find(([, roomBills]) =>
      roomBills.length > 0 && roomBills.every((bill) => bill.status === 'PAID'),
    );
    expect(debtEntry, 'dev 历史数据应有在租且存在待付/逾期账单的房间').toBeTruthy();
    expect(paidEntry, 'dev 历史数据应有在租且账单全部已付的房间').toBeTruthy();

    const [debtRoomId, debtBills] = debtEntry!;
    const expectedDebt = debtBills
      .filter((bill) => ['PENDING', 'OVERDUE'].includes(bill.status))
      .reduce((sum, bill) => sum + Number(bill.totalAmount), 0);
    await page.goto(`/rooms/${debtRoomId}`);
    await expect(page.locator('.van-cell').filter({ hasText: '当前欠费' }).locator('.van-cell__value')).toHaveText(`¥${expectedDebt.toFixed(2)}`);

    await page.goto(`/rooms/${paidEntry![0]}`);
    await expect(page.locator('.van-cell').filter({ hasText: '当前欠费' })).toHaveCount(0);
  });

  test('2.3.7 详情四个 tab 的有数据与无数据展示', async ({ page }) => {
    await login(page);
    const dataRoomId = 990001;
    const emptyRoomId = 990002;
    const baseRoom = {
      buildingId: 1,
      roomNo: '990001',
      floor: 990,
      status: 'VACANT',
      building: { id: 1, name: `${dataPrefix}_展示楼栋` },
      roomType: null,
    };
    const dataRoom = {
      ...baseRoom,
      id: dataRoomId,
      leases: [{
        id: 990001,
        tenant: { name: `${dataPrefix}_展示租客` },
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-12-31T00:00:00.000Z',
        status: 'ENDED',
        bills: [],
      }],
      maintenanceRecords: [{
        id: 990001,
        content: `${dataPrefix}_展示维修`,
        date: '2026-08-01T00:00:00.000Z',
        cost: '10.00',
      }],
      expenses: [{
        id: 990001,
        name: `${dataPrefix}_展示支出`,
        date: '2026-08-01T00:00:00.000Z',
        amount: '20.00',
      }],
      auditLogs: [{
        id: 990001,
        action: `${dataPrefix}_展示操作`,
        createdAt: '2026-08-01T00:00:00.000Z',
      }],
    };
    const emptyRoom = {
      ...baseRoom,
      id: emptyRoomId,
      roomNo: '990002',
      leases: [],
      maintenanceRecords: [],
      expenses: [],
      auditLogs: [],
    };
    await page.route(new RegExp(`/api/v1/rooms/(${dataRoomId}|${emptyRoomId})$`), async (route) => {
      const payload = route.request().url().endsWith(String(dataRoomId)) ? dataRoom : emptyRoom;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, message: 'success', data: payload }),
      });
    });

    const tabs: Array<[string, string]> = [
      ['租约', '暂无租约'],
      ['维修记录', '暂无记录'],
      ['支出', '暂无支出'],
      ['操作日志', '暂无日志'],
    ];
    await page.goto(`/rooms/${dataRoomId}`);
    for (const [index, [label]] of tabs.entries()) {
      await page.getByRole('tab', { name: label, exact: true }).click();
      const panel = page.locator('.van-tab__panel').nth(index);
      await expect(panel.locator('.van-cell').first()).toBeVisible();
      await expect(panel.locator('.van-empty')).toHaveCount(0);
    }

    await page.goto(`/rooms/${emptyRoomId}`);
    for (const [index, [label, emptyText]] of tabs.entries()) {
      await page.getByRole('tab', { name: label, exact: true }).click();
      const panel = page.locator('.van-tab__panel').nth(index);
      await expect(panel.getByText(emptyText, { exact: true })).toBeVisible();
    }
  });
});
