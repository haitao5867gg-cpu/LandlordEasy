import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type APIResponse,
  type Locator,
  type Page,
  type Response,
} from '@playwright/test';

const apiPrefix = '/api/v1';
const currentOpenid = 'mock_landlord_001';
const runId = Date.now().toString().slice(-8);
const dataPrefix = `E2E_QA_${runId}`;
const today = dateString(new Date());
const futureDate = dateString(addDays(new Date(), 365));

// 远程 dev 有真实写入；根级串行可避免失败后 worker 重启继续造数。
test.describe.configure({ mode: 'serial' });

let setupRequest: APIRequestContext;
let landlordToken = '';
let recoveryToken = '';
let originalSettings: SystemSettings;
let currentLandlord: Landlord;
let testLandlord: Landlord | undefined;
let moduleBuilding: Building | undefined;
let moduleRoomType: RoomType | undefined;
let crossBuilding: Building | undefined;
let crossRoomType: RoomType | undefined;
let linkedRooms: Room[] = [];
let flowRoom: Room | undefined;
let flowLease: LeaseDetail | undefined;
let flowBill: BillDetail | undefined;
let occupiedBuilding: Building | undefined;
let occupiedRoomType: RoomType | undefined;
let destructiveAbort = false;

interface ApiEnvelope<T> {
  code: number;
  message?: string;
  data: T;
}

interface SystemSettings {
  reminderPreDays: number;
  reminderOverdueInterval: number;
  qrcodeImageUrl: string;
}

interface Landlord {
  id: number;
  openid: string;
  name: string;
  isActive: boolean;
}

interface Building {
  id: number;
  name: string;
  sort: number;
}

interface RoomType {
  id: number;
  name: string;
  description?: string;
  defaultRent: string | number;
  defaultDeposit: string | number;
  defaultPayCycle: string;
}

interface Room {
  id: number;
  buildingId: number;
  roomNo: string;
  floor: number;
  roomTypeId?: number | null;
  status: string;
  remark?: string;
  building?: Building;
  roomType?: RoomType | null;
  leases?: LeaseDetail[];
}

interface LeaseDetail {
  id: number;
  roomId: number;
  tenantId: number;
  status: string;
  rent: string | number;
  deposit: string | number;
  inviteCode: string;
  bills?: BillDetail[];
}

interface BillDetail {
  id: number;
  leaseId: number;
  status: string;
  totalAmount: string | number;
}

function dateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
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

async function landlordGet<T>(pathname: string, token = landlordToken): Promise<T> {
  return apiResult<T>(await setupRequest.get(`${apiPrefix}${pathname}`, { headers: authHeaders(token) }));
}

async function landlordPost<T>(pathname: string, data: unknown, token = landlordToken): Promise<T> {
  return apiResult<T>(await setupRequest.post(`${apiPrefix}${pathname}`, { headers: authHeaders(token), data }));
}

async function landlordPut<T>(pathname: string, data: unknown, token = landlordToken): Promise<T> {
  return apiResult<T>(await setupRequest.put(`${apiPrefix}${pathname}`, { headers: authHeaders(token), data }));
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

async function login(page: Page, pathname: string): Promise<void> {
  await page.addInitScript((token) => localStorage.setItem('landlord_token', token), landlordToken);
  await page.goto(pathname);
  await expect(page).not.toHaveURL(/\/login/);
}

function fieldInput(root: Page | Locator, label: string): Locator {
  return root.locator('.van-field').filter({ hasText: label }).locator('input, textarea').first();
}

function visibleDialog(page: Page): Locator {
  return page.locator('.van-dialog:visible');
}

function listCell(page: Page, text: string): Locator {
  return page.locator('.van-cell').filter({ hasText: text }).first();
}

async function openAddDialog(page: Page): Promise<Locator> {
  await page.locator('.van-nav-bar__right .van-icon-plus').click();
  await expect(visibleDialog(page)).toBeVisible();
  return visibleDialog(page);
}

async function confirmDelete(page: Page, responsePromise: Promise<Response>): Promise<Response> {
  const dialog = visibleDialog(page);
  await expect(dialog).toContainText('确认删除');
  await dialog.getByRole('button', { name: '确认', exact: true }).click();
  return responsePromise;
}

async function restoreSettings(): Promise<void> {
  if (!originalSettings) return;
  await landlordPut<SystemSettings>('/admin/settings', originalSettings);
}

async function deleteBuildingViaUi(page: Page, building: Building): Promise<void> {
  await login(page, '/settings/buildings');
  const cell = listCell(page, building.name);
  await expect(cell).toBeVisible();
  const responsePromise = waitForApi(page, 'DELETE', `/buildings/${building.id}`);
  await cell.locator('.delete-icon').click();
  const response = await confirmDelete(page, responsePromise);
  await pageApiResult(response);
  await expect(page.locator('.van-toast')).toContainText('已删除');
  await expect(page.locator('.van-cell').filter({ hasText: building.name })).toHaveCount(0);
}

async function deleteRoomTypeViaUi(page: Page, roomType: RoomType): Promise<void> {
  await login(page, '/settings/room-types');
  const cell = listCell(page, roomType.name);
  await expect(cell).toBeVisible();
  const responsePromise = waitForApi(page, 'DELETE', `/room-types/${roomType.id}`);
  await cell.locator('.delete-icon').click();
  const response = await confirmDelete(page, responsePromise);
  await pageApiResult(response);
  await expect(page.locator('.van-toast')).toContainText('已删除');
  await expect(page.locator('.van-cell').filter({ hasText: roomType.name })).toHaveCount(0);
}

async function selectPickerOption(page: Page, fieldLabel: string, option: string): Promise<void> {
  await page.locator('.van-field').filter({ hasText: fieldLabel }).click();
  const popup = page.locator('.van-popup--bottom:visible');
  await expect(popup).toBeVisible();
  await expect(popup.getByText(option, { exact: true })).toBeVisible();
  await popup.getByText(option, { exact: true }).click();
  await popup.getByRole('button', { name: '确认', exact: true }).click();
  await expect(fieldInput(page, fieldLabel)).toHaveValue(option);
}

async function safeApiDelete(pathname: string): Promise<void> {
  const response = await setupRequest.delete(`${apiPrefix}${pathname}`, { headers: authHeaders() });
  if (![200, 201, 204, 404].includes(response.status())) {
    console.warn(`CLEANUP_SKIP DELETE ${pathname}: ${response.status()} ${await response.text()}`);
  }
}

test.beforeAll(async () => {
  setupRequest = await playwrightRequest.newContext({ baseURL: 'https://dev.landlordeasy.cn' });
  landlordToken = (await apiResult<{ token: string }>(
    await setupRequest.post(`${apiPrefix}/auth/landlord/login`, { data: { code: currentOpenid } }),
  )).token;

  const [settings, landlords, buildings, roomTypes, rooms] = await Promise.all([
    landlordGet<SystemSettings>('/admin/settings'),
    landlordGet<Landlord[]>('/admin/landlords'),
    landlordGet<Building[]>('/buildings'),
    landlordGet<RoomType[]>('/room-types'),
    landlordGet<Room[]>('/rooms'),
  ]);
  originalSettings = { ...settings };
  currentLandlord = landlords.find((item) => item.openid === currentOpenid)!;
  expect(currentLandlord, `必须先精确确认 ${currentOpenid} 对应账号`).toBeTruthy();
  expect(currentLandlord.isActive).toBeTruthy();

  const payload = JSON.parse(Buffer.from(landlordToken.split('.')[1], 'base64url').toString()) as { sub: number };
  expect(payload.sub, 'JWT sub 必须与当前 mock 账号 ID 一致').toBe(currentLandlord.id);
  console.log(`SAFETY current account: openid=${currentOpenid}, id=${currentLandlord.id}`);

  const occupied = buildings.find((building) => building.name === 'Q栋'
    && rooms.some((room) => room.buildingId === building.id && !room.remark?.includes('E2E_QA_')))
    ?? buildings.find((building) => !building.name.startsWith('E2E_QA_')
      && rooms.some((room) => room.buildingId === building.id && !room.remark?.includes('E2E_QA_')));
  expect(occupied, '必须动态找到一个有真实房间关联的非测试楼栋').toBeTruthy();
  occupiedBuilding = occupied;

  const usedTypeIds = new Set(rooms.filter((room) => room.roomTypeId).map((room) => room.roomTypeId));
  occupiedRoomType = roomTypes.find((roomType) => !roomType.name.startsWith('E2E_QA_') && usedTypeIds.has(roomType.id));
  expect(occupiedRoomType, '必须动态找到一个被真实房间使用的非测试房型').toBeTruthy();
});

test.afterAll(async () => {
  if (!setupRequest) return;
  if (destructiveAbort) {
    await setupRequest.dispose();
    return;
  }

  try {
    await restoreSettings();

    const rescueToken = recoveryToken || landlordToken;
    const landlords = await landlordGet<Landlord[]>('/admin/landlords', rescueToken).catch(() => []);
    const me = landlords.find((item) => item.id === currentLandlord?.id);
    if (me && !me.isActive) {
      await landlordPut(`/admin/landlords/${me.id}`, { isActive: true }, rescueToken);
    }
    const qaLandlord = landlords.find((item) => item.openid === testLandlord?.openid);
    if (qaLandlord?.isActive) {
      await setupRequest.delete(`${apiPrefix}/admin/landlords/${qaLandlord.id}`, { headers: authHeaders(rescueToken) });
    }

    if (flowLease?.id) {
      const lease = await landlordGet<LeaseDetail>(`/leases/${flowLease.id}`).catch(() => undefined);
      if (lease?.status === 'ACTIVE') {
        await landlordPost(`/leases/${lease.id}/end`, {
          endDate: today,
          depositRefund: 0,
          endReason: `${dataPrefix}_失败兜底退租`,
        });
      }
    }

    for (const room of linkedRooms) await safeApiDelete(`/rooms/${room.id}`);
    if (crossRoomType) await safeApiDelete(`/room-types/${crossRoomType.id}`);
    if (crossBuilding) await safeApiDelete(`/buildings/${crossBuilding.id}`);
    if (moduleRoomType) await safeApiDelete(`/room-types/${moduleRoomType.id}`);
    if (moduleBuilding) await safeApiDelete(`/buildings/${moduleBuilding.id}`);
  } finally {
    await setupRequest.dispose();
  }
});

test.describe('2.12 我的', () => {
  test('2.12.1 四个入口分别跳转正确', async ({ page }) => {
    const entries: Array<[string, string]> = [
      ['经营报表', '/reports'],
      ['维修记录', '/maintenance'],
      ['支出管理', '/expenses'],
      ['系统设置', '/settings'],
    ];
    for (const [name, pathname] of entries) {
      await login(page, '/mine');
      await page.getByText(name, { exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${pathname.replace('/', '\\/')}$`));
    }
  });

  test('2.12.2 退出无二次确认并立即清除登录态', async ({ page }) => {
    await login(page, '/mine');
    await expect(page.locator('.van-dialog')).toHaveCount(0);
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('.van-dialog')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('landlord_token'))).toBeNull();
  });

  test('2.12.3 ICP备案 footer 只在我的页显示', async ({ page }) => {
    await login(page, '/mine');
    await expect(page.locator('.icp-footer')).toContainText('沪ICP备2026037197号');
    await page.locator('.van-tabbar-item').filter({ hasText: '工作台' }).click();
    await expect(page).toHaveURL('https://dev.landlordeasy.cn/');
    await expect(page.locator('.icp-footer')).toHaveCount(0);
    await page.locator('.van-tabbar-item').filter({ hasText: '房间' }).click();
    await expect(page).toHaveURL(/\/rooms$/);
    await expect(page.locator('.icp-footer')).toHaveCount(0);
  });
});

test.describe('2.13 系统设置', () => {
  test('2.13.1 修改提醒参数、保存并刷新后持久化', async ({ page }) => {
    const changed = {
      reminderPreDays: originalSettings.reminderPreDays === 6 ? 7 : 6,
      reminderOverdueInterval: originalSettings.reminderOverdueInterval === 8 ? 9 : 8,
    };
    try {
      await login(page, '/settings');
      await fieldInput(page, '提前几天提醒').fill(String(changed.reminderPreDays));
      await fieldInput(page, '逾期间隔(天)').fill(String(changed.reminderOverdueInterval));
      const responsePromise = waitForApi(page, 'PUT', '/admin/settings');
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await pageApiResult<SystemSettings>(await responsePromise);
      await expect(page.locator('.van-toast')).toContainText('已保存');
      await page.reload();
      await expect(fieldInput(page, '提前几天提醒')).toHaveValue(String(changed.reminderPreDays));
      await expect(fieldInput(page, '逾期间隔(天)')).toHaveValue(String(changed.reminderOverdueInterval));
      const persisted = await landlordGet<SystemSettings>('/admin/settings');
      expect(persisted).toMatchObject(changed);
    } finally {
      await restoreSettings();
    }
  });

  test('2.13.2 记录0、负数、非整数的后端实际接受情况', async ({ page }, testInfo) => {
    const observations: Array<Record<string, unknown>> = [];
    try {
      await login(page, '/settings');
      for (const value of ['0', '-1', '1.5']) {
        await fieldInput(page, '提前几天提醒').fill(value);
        await fieldInput(page, '逾期间隔(天)').fill(value);
        const responsePromise = waitForApi(page, 'PUT', '/admin/settings');
        await page.getByRole('button', { name: '保存', exact: true }).click();
        const response = await responsePromise;
        const body = (await response.json()) as ApiEnvelope<SystemSettings>;
        const persisted = await landlordGet<SystemSettings>('/admin/settings');
        observations.push({
          submittedValue: Number(value),
          responseStatus: response.status(),
          responseMessage: body.message ?? '',
          accepted: response.ok() && body.code === 0,
          persistedPreDays: persisted.reminderPreDays,
          persistedOverdueInterval: persisted.reminderOverdueInterval,
        });
        await restoreSettings();
      }
      console.log(`OBSERVATION 2.13.2 ${JSON.stringify(observations)}`);
      testInfo.annotations.push({ type: 'observation', description: JSON.stringify(observations) });
      await testInfo.attach('2.13.2-boundary-observation.json', {
        body: JSON.stringify(observations, null, 2),
        contentType: 'application/json',
      });
      expect(observations).toHaveLength(3);
    } finally {
      await restoreSettings();
    }
  });

  test('2.13.3 选择图片后自动上传并显示预览', async ({ page }) => {
    try {
      await login(page, '/settings');
      const responsePromise = waitForApi(page, 'POST', '/admin/qrcode-upload');
      await page.locator('input[type="file"]').setInputFiles({
        name: `${dataPrefix}_qrcode.png`,
        mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
      });
      const uploaded = await pageApiResult<{ url: string; filename: string }>(await responsePromise);
      expect(uploaded.url).toMatch(/^\/uploads\/qrcode_\d+\.png$/);
      await expect(page.locator('.van-toast')).toContainText('上传成功');
      const preview = page.locator('.van-image img');
      await expect(preview).toBeVisible();
      await expect(preview).toHaveAttribute('src', new RegExp(uploaded.url.replaceAll('/', '\\/')));
    } finally {
      await restoreSettings();
    }
  });

  test('2.13.4 三个管理入口分别跳转正确', async ({ page }) => {
    const entries: Array<[string, string]> = [
      ['白名单管理', '/settings/landlords'],
      ['楼栋管理', '/settings/buildings'],
      ['房型模板管理', '/settings/room-types'],
    ];
    for (const [name, pathname] of entries) {
      await login(page, '/settings');
      await page.getByText(name, { exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${pathname.replaceAll('/', '\\/')}$`));
    }
  });
});

test.describe('2.14 房东白名单', () => {
  test('2.14.1 新增测试房东后列表显示启用', async ({ page }) => {
    await login(page, '/settings/landlords');
    const dialog = await openAddDialog(page);
    await fieldInput(dialog, 'OpenID').fill(`${dataPrefix}_landlord`);
    await fieldInput(dialog, '姓名').fill(`${dataPrefix}_测试房东`);
    const responsePromise = waitForApi(page, 'POST', '/admin/landlords');
    await dialog.getByRole('button', { name: '确认', exact: true }).click();
    testLandlord = await pageApiResult<Landlord>(await responsePromise);
    await expect(page.locator('.van-toast')).toContainText('已添加');
    const cell = listCell(page, testLandlord.openid);
    await expect(cell).toBeVisible();
    await expect(cell.locator('.van-tag')).toHaveText('启用');
    expect(testLandlord.isActive).toBeTruthy();

    recoveryToken = (await apiResult<{ token: string }>(
      await setupRequest.post(`${apiPrefix}/auth/landlord/login`, { data: { code: testLandlord.openid } }),
    )).token;
  });

  test('2.14.2 重复 OpenID 被拒绝并提示已存在', async ({ page }) => {
    expect(testLandlord).toBeTruthy();
    await login(page, '/settings/landlords');
    const dialog = await openAddDialog(page);
    await fieldInput(dialog, 'OpenID').fill(testLandlord!.openid);
    await fieldInput(dialog, '姓名').fill(`${dataPrefix}_重复房东`);
    const responsePromise = waitForApi(page, 'POST', '/admin/landlords');
    await dialog.getByRole('button', { name: '确认', exact: true }).click();
    const response = await responsePromise;
    const body = (await response.json()) as ApiEnvelope<unknown>;
    expect(response.status()).toBe(400);
    expect(body.message).toMatch(/该\s*openid\s*已存在/i);
    await expect(page.locator('.van-toast')).toContainText(/该\s*openid\s*已存在/i);
    expect((await landlordGet<Landlord[]>('/admin/landlords')).filter((item) => item.openid === testLandlord!.openid)).toHaveLength(1);
  });

  // 先于 2.14.3 执行，以便测试房东仍为启用状态并可作为紧急恢复账号。
  test('2.14.4 当前账号自禁用被拒绝，账号保持启用', async ({ page }) => {
    expect(recoveryToken, '高风险操作前必须准备独立恢复 token').toBeTruthy();
    await login(page, '/settings/landlords');
    const cell = listCell(page, currentOpenid);
    await expect(cell).toContainText(currentLandlord.name);
    await expect(cell.locator('.van-tag')).toHaveText('启用');
    const responsePromise = waitForApi(page, 'DELETE', `/admin/landlords/${currentLandlord.id}`);
    await cell.getByRole('button', { name: '禁用', exact: true }).click();
    const response = await responsePromise;
    const body = (await response.json()) as ApiEnvelope<unknown>;

    if (response.ok()) {
      const restoreResponse = await setupRequest.put(`${apiPrefix}/admin/landlords/${currentLandlord.id}`, {
        headers: authHeaders(recoveryToken),
        data: { isActive: true },
      });
      expect(restoreResponse.ok(), '意外自禁用后必须立即通过恢复账号重新启用').toBeTruthy();
    }

    const after = (await landlordGet<Landlord[]>('/admin/landlords', recoveryToken))
      .find((item) => item.id === currentLandlord.id);
    expect(after?.isActive, '无论接口结果如何，当前账号最终必须保持启用').toBeTruthy();
    expect(response.status()).toBe(400);
    expect(body.message).toContain('不能移除自己');
    await expect(page.locator('.van-toast')).toContainText('不能移除自己');
  });

  test('2.14.3 禁用测试房东后 Tag 变化且禁用按钮消失', async ({ page }) => {
    expect(testLandlord).toBeTruthy();
    await login(page, '/settings/landlords');
    const cell = listCell(page, testLandlord!.openid);
    const responsePromise = waitForApi(page, 'DELETE', `/admin/landlords/${testLandlord!.id}`);
    await cell.getByRole('button', { name: '禁用', exact: true }).click();
    await pageApiResult(await responsePromise);
    await expect(page.locator('.van-toast')).toContainText('已禁用');
    await expect(cell.locator('.van-tag')).toHaveText('禁用');
    await expect(cell.getByRole('button', { name: '禁用', exact: true })).toHaveCount(0);
  });

  test('2.14.5 已禁用房东没有重新启用入口', async ({ page }) => {
    expect(testLandlord).toBeTruthy();
    await login(page, '/settings/landlords');
    const cell = listCell(page, testLandlord!.openid);
    await expect(cell.locator('.van-tag')).toHaveText('禁用');
    await expect(cell.getByRole('button')).toHaveCount(0);
    await expect(cell.getByText(/重新启用|启用账号/)).toHaveCount(0);
  });
});

test.describe('2.15 楼栋管理', () => {
  test('2.15.1 新增测试楼栋并在房间列表楼栋 Tab 显示', async ({ page }) => {
    await login(page, '/settings/buildings');
    const dialog = await openAddDialog(page);
    await fieldInput(dialog, '名称').fill(`${dataPrefix}_测试楼栋`);
    await fieldInput(dialog, '排序').fill('901');
    const responsePromise = waitForApi(page, 'POST', '/buildings');
    await dialog.getByRole('button', { name: '确认', exact: true }).click();
    moduleBuilding = await pageApiResult<Building>(await responsePromise);
    await expect(page.locator('.van-toast')).toContainText('已添加');
    await expect(listCell(page, moduleBuilding.name)).toContainText('排序: 901');

    const buildingsPromise = waitForApi(page, 'GET', '/buildings');
    await page.locator('.van-tabbar-item').filter({ hasText: '房间' }).click();
    await buildingsPromise;
    await expect(page.getByRole('tab', { name: moduleBuilding.name, exact: true })).toBeVisible();
  });

  test('2.15.2 编辑楼栋名称和排序后保存生效', async ({ page }) => {
    expect(moduleBuilding).toBeTruthy();
    await login(page, '/settings/buildings');
    const cell = listCell(page, moduleBuilding!.name);
    await cell.locator('.van-cell__title').click();
    const dialog = visibleDialog(page);
    await expect(dialog).toContainText('编辑楼栋');
    await expect(fieldInput(dialog, '名称')).toHaveValue(moduleBuilding!.name);
    await expect(fieldInput(dialog, '排序')).toHaveValue('901');
    const editedName = `${dataPrefix}_测试楼栋_已编辑`;
    await fieldInput(dialog, '名称').fill(editedName);
    await fieldInput(dialog, '排序').fill('902');
    const responsePromise = waitForApi(page, 'PUT', `/buildings/${moduleBuilding!.id}`);
    await dialog.getByRole('button', { name: '确认', exact: true }).click();
    moduleBuilding = await pageApiResult<Building>(await responsePromise);
    await expect(page.locator('.van-toast')).toContainText('已更新');
    await expect(listCell(page, editedName)).toContainText('排序: 902');
    expect((await landlordGet<Building[]>('/buildings')).find((item) => item.id === moduleBuilding!.id)).toMatchObject({ name: editedName, sort: 902 });
  });

  test('2.15.3 删除有真实房间关联的楼栋被拒绝且楼栋未丢失', async ({ page }) => {
    expect(occupiedBuilding).toBeTruthy();
    const beforeRooms = (await landlordGet<Room[]>('/rooms'))
      .filter((room) => room.buildingId === occupiedBuilding!.id && !room.remark?.includes('E2E_QA_'));
    expect(beforeRooms.length, '点击删除前必须再次确认该真实楼栋确有真实房间').toBeGreaterThan(0);
    console.log(`SAFETY 2.15.3 occupied building: ${occupiedBuilding!.name}#${occupiedBuilding!.id}, realRooms=${beforeRooms.length}`);

    await login(page, '/settings/buildings');
    const cell = listCell(page, occupiedBuilding!.name);
    const responsePromise = waitForApi(page, 'DELETE', `/buildings/${occupiedBuilding!.id}`);
    await cell.locator('.delete-icon').click();
    const response = await confirmDelete(page, responsePromise);
    const body = (await response.json()) as ApiEnvelope<unknown>;
    if (response.ok()) {
      destructiveAbort = true;
      throw new Error(`高风险中止：真实楼栋 ${occupiedBuilding!.name}#${occupiedBuilding!.id} 意外删除成功；已立即停止，未尝试修复`);
    }
    expect(response.status()).toBe(400);
    expect(body.message).toContain('该楼栋下有房间,无法删除');
    await expect(page.locator('.van-toast')).toContainText('该楼栋下有房间,无法删除');
    expect((await landlordGet<Building[]>('/buildings')).some((item) => item.id === occupiedBuilding!.id)).toBeTruthy();
    expect((await landlordGet<Room[]>('/rooms')).filter((room) => room.buildingId === occupiedBuilding!.id).length).toBeGreaterThanOrEqual(beforeRooms.length);
  });

  test('2.15.4 删除无房间关联的测试楼栋成功', async ({ page }) => {
    expect(moduleBuilding).toBeTruthy();
    expect((await landlordGet<Room[]>('/rooms')).filter((room) => room.buildingId === moduleBuilding!.id)).toHaveLength(0);
    await deleteBuildingViaUi(page, moduleBuilding!);
    expect((await landlordGet<Building[]>('/buildings')).some((item) => item.id === moduleBuilding!.id)).toBeFalsy();
  });
});

test.describe('2.16 房型管理', () => {
  test('2.16.1 新增测试房型并保存默认租金、押金和付款周期', async ({ page }) => {
    await login(page, '/settings/room-types');
    const dialog = await openAddDialog(page);
    await fieldInput(dialog, '名称').fill(`${dataPrefix}_测试房型`);
    await fieldInput(dialog, '描述').fill(`${dataPrefix}_房型描述`);
    await fieldInput(dialog, '默认租金').fill('1888');
    await fieldInput(dialog, '默认押金').fill('2888');
    await dialog.getByText('季付', { exact: true }).click();
    const responsePromise = waitForApi(page, 'POST', '/room-types');
    await dialog.getByRole('button', { name: '确认', exact: true }).click();
    moduleRoomType = await pageApiResult<RoomType>(await responsePromise);
    await expect(page.locator('.van-toast')).toContainText('已添加');
    await expect(listCell(page, moduleRoomType.name)).toContainText('¥1888/月');
    expect(moduleRoomType).toMatchObject({ defaultPayCycle: 'QUARTERLY' });
    expect(Number(moduleRoomType.defaultRent)).toBe(1888);
    expect(Number(moduleRoomType.defaultDeposit)).toBe(2888);
  });

  test('2.16.2 编辑弹窗正确回填且修改后保存生效', async ({ page }) => {
    expect(moduleRoomType).toBeTruthy();
    await login(page, '/settings/room-types');
    await listCell(page, moduleRoomType!.name).locator('.van-cell__title').click();
    const dialog = visibleDialog(page);
    await expect(dialog).toContainText('编辑房型');
    await expect(fieldInput(dialog, '名称')).toHaveValue(moduleRoomType!.name);
    await expect(fieldInput(dialog, '默认租金')).toHaveValue('1888');
    await expect(fieldInput(dialog, '默认押金')).toHaveValue('2888');
    await expect(dialog.locator('.van-radio').filter({ hasText: '季付' })).toHaveAttribute('aria-checked', 'true');

    const editedName = `${dataPrefix}_测试房型_已编辑`;
    await fieldInput(dialog, '名称').fill(editedName);
    await fieldInput(dialog, '描述').fill(`${dataPrefix}_编辑后描述`);
    await fieldInput(dialog, '默认租金').fill('1999');
    await fieldInput(dialog, '默认押金').fill('2999');
    await dialog.getByText('年付', { exact: true }).click();
    const responsePromise = waitForApi(page, 'PUT', `/room-types/${moduleRoomType!.id}`);
    await dialog.getByRole('button', { name: '确认', exact: true }).click();
    moduleRoomType = await pageApiResult<RoomType>(await responsePromise);
    await expect(page.locator('.van-toast')).toContainText('已更新');
    await expect(listCell(page, editedName)).toContainText('¥1999/月');
    const persisted = (await landlordGet<RoomType[]>('/room-types')).find((item) => item.id === moduleRoomType!.id)!;
    expect(persisted.name).toBe(editedName);
    expect(Number(persisted.defaultRent)).toBe(1999);
    expect(Number(persisted.defaultDeposit)).toBe(2999);
    expect(persisted.defaultPayCycle).toBe('YEARLY');
  });

  test('2.16.3 删除正被真实房间使用的房型被拒绝且房型未丢失', async ({ page }) => {
    expect(occupiedRoomType).toBeTruthy();
    const beforeRooms = (await landlordGet<Room[]>('/rooms'))
      .filter((room) => room.roomTypeId === occupiedRoomType!.id && !room.remark?.includes('E2E_QA_'));
    expect(beforeRooms.length, '点击删除前必须再次确认该房型正被真实房间使用').toBeGreaterThan(0);
    console.log(`SAFETY 2.16.3 occupied room type: ${occupiedRoomType!.name}#${occupiedRoomType!.id}, realRooms=${beforeRooms.length}`);

    await login(page, '/settings/room-types');
    const cell = listCell(page, occupiedRoomType!.name);
    const responsePromise = waitForApi(page, 'DELETE', `/room-types/${occupiedRoomType!.id}`);
    await cell.locator('.delete-icon').click();
    const response = await confirmDelete(page, responsePromise);
    const body = (await response.json()) as ApiEnvelope<unknown>;
    if (response.ok()) {
      destructiveAbort = true;
      throw new Error(`高风险中止：真实房型 ${occupiedRoomType!.name}#${occupiedRoomType!.id} 意外删除成功；已立即停止，未尝试修复`);
    }
    expect(response.status()).toBe(400);
    expect(body.message).toContain('有房间使用该房型,无法删除');
    await expect(page.locator('.van-toast')).toContainText('有房间使用该房型,无法删除');
    expect((await landlordGet<RoomType[]>('/room-types')).some((item) => item.id === occupiedRoomType!.id)).toBeTruthy();
    expect((await landlordGet<Room[]>('/rooms')).filter((room) => room.roomTypeId === occupiedRoomType!.id).length).toBeGreaterThanOrEqual(beforeRooms.length);
  });

  test('2.16.4 删除未使用的测试房型成功', async ({ page }) => {
    expect(moduleRoomType).toBeTruthy();
    expect((await landlordGet<Room[]>('/rooms')).filter((room) => room.roomTypeId === moduleRoomType!.id)).toHaveLength(0);
    await deleteRoomTypeViaUi(page, moduleRoomType!);
    expect((await landlordGet<RoomType[]>('/room-types')).some((item) => item.id === moduleRoomType!.id)).toBeFalsy();
  });
});

// 为减少残留，按依赖顺序先执行 3.2、3.3并清理联动数据，最后执行完整业务闭环 3.1。
test.describe('3 跨模块链路测试', () => {
  test('3.2 新增楼栋后不刷新应用即可在批量建房选择器看到', async ({ page }) => {
    await login(page, '/settings/buildings');
    const dialog = await openAddDialog(page);
    await fieldInput(dialog, '名称').fill(`${dataPrefix}_联动楼栋`);
    await fieldInput(dialog, '排序').fill('903');
    const responsePromise = waitForApi(page, 'POST', '/buildings');
    await dialog.getByRole('button', { name: '确认', exact: true }).click();
    crossBuilding = await pageApiResult<Building>(await responsePromise);
    await expect(page.locator('.van-toast')).toContainText('已添加');

    // 仅通过 SPA 导航切换，不调用 reload/goto。
    await page.locator('.van-tabbar-item').filter({ hasText: '房间' }).click();
    await expect(page).toHaveURL(/\/rooms$/);
    await page.locator('.van-nav-bar__right .van-icon-plus').click();
    await expect(page).toHaveURL(/\/rooms\/batch-create$/);
    await page.locator('.van-field').filter({ hasText: '楼栋' }).click();
    await expect(page.locator('.van-popup--bottom:visible').getByText(crossBuilding.name, { exact: true })).toBeVisible();
    await page.locator('.van-popup--bottom:visible').getByRole('button', { name: '取消', exact: true }).click();
  });

  test('3.3 新增房型后批量建房，详情显示正确房型并清理联动数据', async ({ page }) => {
    expect(crossBuilding).toBeTruthy();
    await login(page, '/settings/room-types');
    const dialog = await openAddDialog(page);
    await fieldInput(dialog, '名称').fill(`${dataPrefix}_联动房型`);
    await fieldInput(dialog, '描述').fill(`${dataPrefix}_跨模块`);
    await fieldInput(dialog, '默认租金').fill('1666');
    await fieldInput(dialog, '默认押金').fill('1666');
    const createTypePromise = waitForApi(page, 'POST', '/room-types');
    await dialog.getByRole('button', { name: '确认', exact: true }).click();
    crossRoomType = await pageApiResult<RoomType>(await createTypePromise);

    await page.locator('.van-tabbar-item').filter({ hasText: '房间' }).click();
    await page.locator('.van-nav-bar__right .van-icon-plus').click();
    await expect(page).toHaveURL(/\/rooms\/batch-create$/);
    await selectPickerOption(page, '楼栋', crossBuilding!.name);
    await selectPickerOption(page, '房型(可选)', crossRoomType.name);
    const startRoom = Number(`7${runId.slice(-5)}`);
    await fieldInput(page, '起始房号').fill(String(startRoom));
    await fieldInput(page, '结束房号').fill(String(startRoom + 1));
    const batchPromise = waitForApi(page, 'POST', '/rooms/batch');
    await page.getByRole('button', { name: '提交', exact: true }).click();
    const batch = await pageApiResult<{ created: number; total: number; skipped: string[] }>(await batchPromise);
    expect(batch).toMatchObject({ created: 2, total: 2, skipped: [] });

    const allRooms = await landlordGet<Room[]>('/rooms');
    linkedRooms = allRooms.filter((room) => room.buildingId === crossBuilding!.id
      && [String(startRoom), String(startRoom + 1)].includes(room.roomNo));
    expect(linkedRooms).toHaveLength(2);
    expect(linkedRooms.every((room) => room.roomTypeId === crossRoomType!.id)).toBeTruthy();

    await login(page, `/rooms/${linkedRooms[0].id}`);
    await expect(page.locator('.van-cell').filter({ hasText: '房型' }).locator('.van-cell__value')).toHaveText(crossRoomType.name);

    // 房间无租约，可用现有 DELETE API 清理；楼栋/房型仍优先走前端删除入口。
    for (const room of linkedRooms) await safeApiDelete(`/rooms/${room.id}`);
    expect((await landlordGet<Room[]>('/rooms')).filter((room) => linkedRooms.some((created) => created.id === room.id))).toHaveLength(0);
    await deleteRoomTypeViaUi(page, crossRoomType);
    await deleteBuildingViaUi(page, crossBuilding!);
  });

  test('3.1 空置到签约、出账、付清、欠费归零、退租再空置完整闭环', async ({ page }) => {
    const buildings = await landlordGet<Building[]>('/buildings');
    const realBuilding = buildings.find((item) => item.id === occupiedBuilding!.id) ?? buildings[0];
    const roomNo = `8${runId.slice(-6)}`;
    flowRoom = await landlordPost<Room>('/rooms', {
      buildingId: realBuilding.id,
      roomNo,
      floor: 8,
      remark: `${dataPrefix}_完整业务闭环`,
    });
    expect(flowRoom.status).toBe('VACANT');

    await login(page, `/rooms/${flowRoom.id}`);
    await expect(page.locator('.van-cell').filter({ hasText: '状态' }).locator('.van-tag')).toHaveText('空置');
    await page.getByRole('button', { name: '新签租约', exact: true }).click();
    await fieldInput(page, '姓名').fill(`${dataPrefix}_闭环租客`);
    await fieldInput(page, '手机号').fill(`139${runId}`);
    await fieldInput(page, '月租金').fill('1777');
    await fieldInput(page, '押金').fill('1777');
    const leasePromise = waitForApi(page, 'POST', '/leases');
    await page.getByRole('button', { name: '确认签约', exact: true }).click();
    flowLease = await pageApiResult<LeaseDetail>(await leasePromise);
    expect(flowLease.inviteCode).toMatch(/^[A-Z0-9]{8}$/);
    expect((await landlordGet<Room>(`/rooms/${flowRoom.id}`)).status).toBe('RENTED');
    await visibleDialog(page).getByRole('button', { name: '完成', exact: true }).click();

    await landlordPost('/bills/generate', {});
    const leaseBills = await landlordGet<BillDetail[]>(`/bills?leaseId=${flowLease.id}`);
    flowBill = leaseBills.find((bill) => bill.status === 'PENDING');
    expect(flowBill, '调试出账后必须找到本租约待付账单').toBeTruthy();

    await login(page, `/rooms/${flowRoom.id}`);
    await expect(page.locator('.van-cell').filter({ hasText: '当前欠费' })).toContainText(`¥${Number(flowBill!.totalAmount).toFixed(2)}`);
    await login(page, `/bills/${flowBill!.id}`);
    await expect(page.locator('.van-cell').filter({ hasText: '状态' }).locator('.van-tag')).toHaveText('待付');
    await page.getByRole('button', { name: '手动记账(现金/转账)', exact: true }).click();
    const payDialog = visibleDialog(page);
    await fieldInput(payDialog, '金额').fill(String(flowBill!.totalAmount));
    const paymentPromise = waitForApi(page, 'POST', '/payments/manual');
    await payDialog.getByRole('button', { name: '确认', exact: true }).click();
    await pageApiResult(await paymentPromise);
    await expect(page.locator('.van-toast')).toContainText('记账成功');
    await expect(page.locator('.van-cell').filter({ hasText: '状态' }).locator('.van-tag')).toHaveText('已付');
    expect((await landlordGet<BillDetail>(`/bills/${flowBill!.id}`)).status).toBe('PAID');

    await login(page, `/rooms/${flowRoom.id}`);
    await expect(page.locator('.van-cell').filter({ hasText: '当前欠费' })).toHaveCount(0);
    await page.locator('.van-cell').filter({ hasText: `${dataPrefix}_闭环租客` }).click();
    await expect(page).toHaveURL(new RegExp(`/leases/${flowLease.id}$`));
    await page.getByRole('button', { name: '退租', exact: true }).click();
    const endDialog = visibleDialog(page);
    await fieldInput(endDialog, '退租日').fill(today);
    await fieldInput(endDialog, '退还押金').fill('1777');
    await fieldInput(endDialog, '退租原因').fill(`${dataPrefix}_闭环完成`);
    const endPromise = waitForApi(page, 'POST', `/leases/${flowLease.id}/end`);
    await endDialog.getByRole('button', { name: '确认', exact: true }).click();
    await pageApiResult(await endPromise);
    await expect(page.locator('.van-toast')).toContainText('退租成功');

    const [endedLease, vacantRoom] = await Promise.all([
      landlordGet<LeaseDetail>(`/leases/${flowLease.id}`),
      landlordGet<Room>(`/rooms/${flowRoom.id}`),
    ]);
    expect(endedLease.status).toBe('ENDED');
    expect(vacantRoom.status).toBe('VACANT');
    await login(page, `/rooms/${flowRoom.id}`);
    await expect(page.locator('.van-cell').filter({ hasText: '状态' }).locator('.van-tag')).toHaveText('空置');
    await expect(page.locator('.van-cell').filter({ hasText: '当前欠费' })).toHaveCount(0);
  });
});
