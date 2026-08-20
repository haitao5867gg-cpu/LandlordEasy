import { Prisma, PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const DATASET_LATEST_MONTH = parseDate('2026-07-01');
const DATE_GAP_DAYS = 10;
const DEPOSIT_CHANGE_MIN_AMOUNT = 300;
const DEPOSIT_CHANGE_MIN_RATIO = 0.15;
const KEYWORDS = ['转租', '新签', '退房', '到期退', '前客户', '调房'] as const;
const DEPARTURE_KEYWORDS = ['退房', '到期退', '调房'] as const;
const ALLOWED_DATABASE_NAMES = new Set(['landlord_easy', 'landlordeasy_dev']);

type PropertyName = '嘉定公寓' | '明远公寓';
type RawCsvRow = Record<string, string>;

interface BaseRentRow {
  property: PropertyName;
  sourceRoomNo: string;
  deposit: number | null;
  rent: number | null;
  newDeposit: number | null;
  depositRefund: number | null;
  plate: string;
  parkingFee: number | null;
  commission: number | null;
  remark: string;
  sheet: string;
  sourceMonth: Date;
  sourceIndex: number;
}

interface LedgerRow extends BaseRentRow {
  kind: 'ledger';
  periodStart: Date;
  periodEnd: Date;
}

interface EventRow extends BaseRentRow {
  kind: 'event';
}

type TimelineRow = LedgerRow | EventRow;

interface LeaseSegment {
  property: PropertyName;
  sourceRoomNo: string;
  rows: LedgerRow[];
  events: EventRow[];
  boundaryReasons: string[];
  endReasons: string[];
  endedByDeparture: boolean;
}

interface RoomIdentity {
  buildingName: string;
  roomNo: string;
  floor: number;
}

interface LowConfidenceSplit {
  property: PropertyName;
  room: string;
  sourceMonth: string;
  periodStart: string;
  reasons: string[];
}

interface ImportStats {
  buildings: number;
  roomTypes: number;
  rooms: number;
  tenants: number;
  leases: number;
  activeLeases: number;
  bills: number;
  payments: number;
  billItems: number;
  depositReceives: number;
  depositRefunds: number;
  expenses: number;
  commissionExpenses: number;
  skippedEmptyRentRows: number;
  mergedBillRows: number;
  unassignedDepositEvents: number;
}

const prisma = new PrismaClient();

function loadLocalEnv(): void {
  if (process.env.DATABASE_URL) return;

  const envPath = path.resolve(__dirname, '../../.env');
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1] in process.env) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    process.env[match[1]] = value;
  }
}

function assertLocalDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL 未配置，拒绝执行导入');

  const parsed = new URL(databaseUrl);
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  const databaseName = parsed.pathname.replace(/^\//, '');
  if (parsed.protocol !== 'mysql:' || !localHosts.has(parsed.hostname)) {
    throw new Error(`安全检查失败：只允许本地 MySQL，当前目标为 ${parsed.hostname}`);
  }
  if (!ALLOWED_DATABASE_NAMES.has(databaseName)) {
    throw new Error(
      `安全检查失败：只允许数据库 ${[...ALLOWED_DATABASE_NAMES].join('、')}，当前为 ${databaseName}`,
    );
  }

  const confirmTargetPrefix = '--confirm-target=';
  const confirmedDatabaseName = process.argv
    .find((argument) => argument.startsWith(confirmTargetPrefix))
    ?.slice(confirmTargetPrefix.length);
  if (confirmedDatabaseName !== databaseName) {
    throw new Error(
      `安全检查失败：必须显式传入 --confirm-target=${databaseName}，且参数值需与 DATABASE_URL 中的数据库名完全一致${confirmedDatabaseName === undefined ? '' : `（当前为 ${confirmedDatabaseName}）`}`,
    );
  }

  console.log(`🔒 数据库安全检查通过：${parsed.hostname}:${parsed.port || '3306'}/${databaseName}`);
}

function parseCsv(filePath: string): RawCsvRow[] {
  if (!fs.existsSync(filePath)) throw new Error(`数据文件不存在：${filePath}`);

  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    if (inQuotes) {
      if (char === '"' && content[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\n') {
      record.push(field.replace(/\r$/, ''));
      records.push(record);
      record = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || record.length > 0) {
    record.push(field.replace(/\r$/, ''));
    records.push(record);
  }
  if (inQuotes) throw new Error(`CSV 引号未闭合：${filePath}`);
  if (records.length < 2) return [];

  const headers = records[0].map((value) => value.trim());
  return records
    .slice(1)
    .filter((values) => values.some((value) => value.trim() !== ''))
    .map((values, rowIndex) => {
      if (values.length !== headers.length) {
        throw new Error(
          `${path.basename(filePath)} 第 ${rowIndex + 2} 行列数异常：期望 ${headers.length}，实际 ${values.length}`,
        );
      }
      return Object.fromEntries(headers.map((header, index) => [header, values[index].trim()]));
    });
}

function requireHeaders(rows: RawCsvRow[], headers: string[], fileName: string): void {
  if (rows.length === 0) throw new Error(`${fileName} 没有数据`);
  const missing = headers.filter((header) => !(header in rows[0]));
  if (missing.length > 0) throw new Error(`${fileName} 缺少字段：${missing.join(', ')}`);
}

function parseAmount(value: string): number | null {
  if (!value.trim()) return null;
  if (['无押金', '空', '健身房'].includes(value.trim())) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`无法解析金额：${value}`);
  return parsed;
}

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`无法解析日期：${value}`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || formatDate(date) !== value) {
    throw new Error(`无效日期：${value}`);
  }
  return date;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatMonth(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function daysBetween(earlier: Date, later: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / 86_400_000);
}

function asPropertyName(value: string): PropertyName {
  if (value === '嘉定公寓' || value === '明远公寓') return value;
  throw new Error(`未知物业：${value}`);
}

function buildSheetMonthMap(rows: RawCsvRow[]): Map<string, Date> {
  const rowsBySheet = new Map<string, RawCsvRow[]>();
  for (const row of rows) {
    const property = asPropertyName(row.property);
    const key = `${property}|${row.sheet}`;
    const sheetRows = rowsBySheet.get(key) ?? [];
    sheetRows.push(row);
    rowsBySheet.set(key, sheetRows);
  }

  const result = new Map<string, Date>();
  for (const [key, sheetRows] of rowsBySheet) {
    const [property, sheet] = key.split('|', 2);
    const monthCounts = new Map<string, number>();
    for (const row of sheetRows) {
      const periodMonth = formatMonth(parseDate(row.period_start.trim()));
      monthCounts.set(periodMonth, (monthCounts.get(periodMonth) ?? 0) + 1);
    }

    const maxCount = Math.max(...monthCounts.values());
    const modeMonths = [...monthCounts.entries()]
      .filter(([, count]) => count === maxCount)
      .map(([month]) => month)
      .sort();
    if (modeMonths.length !== 1) {
      throw new Error(
        `sheet 账期月份众数不唯一：${property}/${sheet} (${modeMonths.join(', ')})`,
      );
    }

    const sourceMonth = parseDate(`${modeMonths[0]}-01`);
    const chineseMonth = Number(sheet.match(/^(\d{1,2})月/)?.[1]);
    if (chineseMonth !== sourceMonth.getUTCMonth() + 1) {
      throw new Error(
        `sheet 月份校验失败：${property}/${sheet} 的账期众数为 ${formatMonth(sourceMonth)}`,
      );
    }
    result.set(key, sourceMonth);
  }
  return result;
}

function parseBaseRentRow(
  row: RawCsvRow,
  sourceIndex: number,
  sheetMonths: Map<string, Date>,
): BaseRentRow {
  const property = asPropertyName(row.property);
  const sourceRoomNo = row.room.trim().toUpperCase();
  if (!sourceRoomNo) throw new Error(`第 ${sourceIndex + 2} 行房号为空`);
  const sourceMonth = sheetMonths.get(`${property}|${row.sheet}`);
  if (!sourceMonth) throw new Error(`找不到 sheet 月份：${property}/${row.sheet}`);

  return {
    property,
    sourceRoomNo,
    deposit: parseAmount(row.deposit),
    rent: parseAmount(row.rent),
    newDeposit: parseAmount(row.new_deposit),
    depositRefund: parseAmount(row.deposit_refund),
    plate: row.plate.trim(),
    parkingFee: parseAmount(row.parking_fee),
    commission: parseAmount(row.commission),
    remark: row.remark.trim(),
    sheet: row.sheet,
    sourceMonth,
    sourceIndex,
  };
}

function parseLedgerRows(rows: RawCsvRow[], sheetMonths: Map<string, Date>): LedgerRow[] {
  return rows.map((row, index) => ({
    ...parseBaseRentRow(row, index, sheetMonths),
    kind: 'ledger',
    periodStart: parseDate(row.period_start),
    periodEnd: parseDate(row.period_end),
  }));
}

function parseEventRows(rows: RawCsvRow[], sheetMonths: Map<string, Date>): EventRow[] {
  return rows.map((row, index) => ({
    ...parseBaseRentRow(row, index, sheetMonths),
    kind: 'event',
  }));
}

function roomKey(property: PropertyName, sourceRoomNo: string): string {
  return `${property}|${sourceRoomNo}`;
}

function getRoomIdentity(property: PropertyName, sourceRoomNo: string): RoomIdentity {
  if (property === '嘉定公寓') {
    const match = sourceRoomNo.match(/^([QRS])(\d+)$/);
    if (!match) throw new Error(`嘉定房号格式异常：${sourceRoomNo}`);
    const roomNo = match[2];
    return {
      buildingName: `${match[1]}栋`,
      roomNo,
      floor: Math.floor(Number.parseInt(roomNo, 10) / 100),
    };
  }

  if (!/^\d+$/.test(sourceRoomNo)) throw new Error(`明远房号格式异常：${sourceRoomNo}`);
  return {
    buildingName: '明远公寓',
    roomNo: sourceRoomNo,
    floor: Math.floor(Number.parseInt(sourceRoomNo, 10) / 100),
  };
}

function positive(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

function matchingKeywords(remark: string): string[] {
  return KEYWORDS.filter((keyword) => remark.includes(keyword));
}

function hasDepartureSignal(row: BaseRentRow): boolean {
  return (
    positive(row.depositRefund) !== null ||
    DEPARTURE_KEYWORDS.some((keyword) => row.remark.includes(keyword))
  );
}

function newSegment(row: LedgerRow, boundaryReasons: string[]): LeaseSegment {
  return {
    property: row.property,
    sourceRoomNo: row.sourceRoomNo,
    rows: [],
    events: [],
    boundaryReasons,
    endReasons: [],
    endedByDeparture: false,
  };
}

function splitLeases(
  ledgerRows: LedgerRow[],
  eventRows: EventRow[],
): { segments: LeaseSegment[]; lowConfidence: LowConfidenceSplit[] } {
  const timelines = new Map<string, TimelineRow[]>();
  for (const row of [...ledgerRows, ...eventRows]) {
    const key = roomKey(row.property, row.sourceRoomNo);
    const timeline = timelines.get(key) ?? [];
    timeline.push(row);
    timelines.set(key, timeline);
  }

  const allSegments: LeaseSegment[] = [];
  const lowConfidence: LowConfidenceSplit[] = [];

  for (const timeline of timelines.values()) {
    timeline.sort((left, right) => {
      const leftTime = left.kind === 'ledger' ? left.periodStart : left.sourceMonth;
      const rightTime = right.kind === 'ledger' ? right.periodStart : right.sourceMonth;
      const timeDifference = leftTime.getTime() - rightTime.getTime();
      if (timeDifference !== 0) return timeDifference;
      if (left.kind !== right.kind) return left.kind === 'ledger' ? -1 : 1;
      return left.sourceIndex - right.sourceIndex;
    });

    let current: LeaseSegment | null = null;
    let previousLedger: LedgerRow | null = null;
    let pendingBoundaryReason: string | null = null;
    const leadingEvents: EventRow[] = [];

    for (const row of timeline) {
      if (row.kind === 'event') {
        if (!current) {
          leadingEvents.push(row);
          continue;
        }
        current.events.push(row);
        if (hasDepartureSignal(row)) {
          const reason = `无账期事件(${formatMonth(row.sourceMonth)}): ${row.remark || '押金退款'}`;
          current.endedByDeparture = true;
          current.endReasons.push(reason);
          pendingBoundaryReason = reason;
        }
        continue;
      }

      const repeatedRemark =
        previousLedger !== null &&
        row.remark.length > 0 &&
        row.remark === previousLedger.remark;

      if (!current) {
        current = newSegment(row, []);
        current.events.push(...leadingEvents);
        if (leadingEvents.length > 0) {
          current.endReasons.push(
            `早于首条账期的事件归档到最早可识别租约：${leadingEvents
              .map((event) => `${formatMonth(event.sourceMonth)} ${event.remark || '押金事件'}`)
              .join('；')}`,
          );
        }
        allSegments.push(current);
      } else {
        const hasLeaseActivity = positive(row.rent) !== null || positive(row.newDeposit) !== null;
        const reasons: string[] = [];

        if (hasLeaseActivity && pendingBoundaryReason) reasons.push(pendingBoundaryReason);

        if (hasLeaseActivity && !repeatedRemark) {
          for (const keyword of matchingKeywords(row.remark)) {
            reasons.push(`备注关键词:${keyword}`);
          }
        }

        if (
          hasLeaseActivity &&
          positive(row.newDeposit) !== null &&
          positive(row.depositRefund) !== null
        ) {
          reasons.push('同月同时收取新押金并退还旧押金');
        }

        if (hasLeaseActivity && previousLedger) {
          const gapDays = daysBetween(previousLedger.periodEnd, row.periodStart);
          if (gapDays > DATE_GAP_DAYS) {
            reasons.push(
              `日期缺口:${formatDate(previousLedger.periodEnd)}→${formatDate(row.periodStart)}，${gapDays}天`,
            );
          }

          const previousDeposit = positive(previousLedger.deposit);
          const currentDeposit = positive(row.deposit);
          if (previousDeposit !== null && currentDeposit !== null) {
            const difference = Math.abs(currentDeposit - previousDeposit);
            const ratio = difference / previousDeposit;
            if (
              difference >= DEPOSIT_CHANGE_MIN_AMOUNT &&
              ratio >= DEPOSIT_CHANGE_MIN_RATIO
            ) {
              reasons.push(
                `押金大幅变化:${previousDeposit}→${currentDeposit}(${Math.round(ratio * 100)}%)`,
              );
            }
          }
        }

        if (hasLeaseActivity && reasons.length > 0) {
          current.endReasons.push(`下一租约边界: ${reasons.join('；')}`);
          current = newSegment(row, reasons);
          allSegments.push(current);
          pendingBoundaryReason = null;

          if (reasons.length === 1 && reasons[0].startsWith('日期缺口:')) {
            lowConfidence.push({
              property: row.property,
              room: row.sourceRoomNo,
              sourceMonth: formatMonth(row.sourceMonth),
              periodStart: formatDate(row.periodStart),
              reasons,
            });
          }
        }
      }

      current.rows.push(row);

      if (hasDepartureSignal(row) && positive(row.rent) === null) {
        const reason = `无租金退租行(${formatMonth(row.sourceMonth)}): ${row.remark || '押金退款'}`;
        current.endedByDeparture = true;
        current.endReasons.push(reason);
        pendingBoundaryReason = reason;
      }
      previousLedger = row;
    }

    if (
      current &&
      previousLedger &&
      positive(previousLedger.rent) !== null &&
      DEPARTURE_KEYWORDS.some((keyword) => previousLedger.remark.includes(keyword))
    ) {
      const reason = `最后账期行退租信号(${formatMonth(previousLedger.sourceMonth)}): ${previousLedger.remark}`;
      current.endedByDeparture = true;
      current.endReasons.push(reason);
    }
  }

  return { segments: allSegments, lowConfidence };
}

function mode(values: Array<number | null>, tieTarget?: number): number {
  const counts = new Map<number, number>();
  for (const value of values) {
    if (value !== null && value > 0) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  if (counts.size === 0) return 0;

  const maxCount = Math.max(...counts.values());
  const candidates = [...counts.entries()]
    .filter(([, count]) => count === maxCount)
    .map(([value]) => value);
  if (tieTarget !== undefined && tieTarget > 0) {
    candidates.sort((left, right) => {
      const targetDifference = Math.abs(left - tieTarget) - Math.abs(right - tieTarget);
      return targetDifference || left - right;
    });
  } else {
    candidates.sort((left, right) => left - right);
  }
  return candidates[0];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function getSegmentDates(
  segment: LeaseSegment,
  nextSegment?: LeaseSegment,
): { startDate: Date; endDate: Date } {
  const starts = segment.rows.map((row) => row.periodStart.getTime());
  const ends = segment.rows.map((row) => row.periodEnd.getTime());
  const startDate = new Date(Math.min(...starts));
  let endDate = new Date(Math.max(...ends));

  if (nextSegment) {
    const nextStartDate = new Date(
      Math.min(...nextSegment.rows.map((row) => row.periodStart.getTime())),
    );
    if (endDate > nextStartDate) endDate = nextStartDate;
  }

  return { startDate, endDate };
}

function getLatestSourceMonth(segment: LeaseSegment): Date {
  return new Date(
    Math.max(
      ...segment.rows.map((row) => row.sourceMonth.getTime()),
      ...segment.events.map((row) => row.sourceMonth.getTime()),
    ),
  );
}

function getSegmentDeposit(segment: LeaseSegment): number {
  return mode(segment.rows.map((row) => row.deposit));
}

function getSegmentRent(segment: LeaseSegment): number {
  const deposit = getSegmentDeposit(segment);
  return mode(
    segment.rows.map((row) => row.rent),
    deposit,
  );
}

function sourceMonthTimestamp(row: BaseRentRow): Date {
  return new Date(row.sourceMonth.getTime());
}

function getDataDir(): string {
  return process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(__dirname, '../../../../data/import/history-2026-08');
}

async function getCounts(): Promise<Record<string, number>> {
  const [
    buildings,
    roomTypes,
    rooms,
    tenants,
    leases,
    bills,
    billItems,
    payments,
    depositRecords,
    handoverRecords,
    maintenanceRecords,
    expenses,
    reminderLogs,
  ] = await Promise.all([
    prisma.building.count(),
    prisma.roomType.count(),
    prisma.room.count(),
    prisma.tenant.count(),
    prisma.lease.count(),
    prisma.bill.count(),
    prisma.billItem.count(),
    prisma.payment.count(),
    prisma.depositRecord.count(),
    prisma.handoverRecord.count(),
    prisma.maintenanceRecord.count(),
    prisma.expense.count(),
    prisma.reminderLog.count(),
  ]);
  return {
    Building: buildings,
    RoomType: roomTypes,
    Room: rooms,
    Tenant: tenants,
    Lease: leases,
    Bill: bills,
    BillItem: billItems,
    Payment: payments,
    DepositRecord: depositRecords,
    HandoverRecord: handoverRecords,
    MaintenanceRecord: maintenanceRecords,
    Expense: expenses,
    ReminderLog: reminderLogs,
  };
}

async function clearReplaceableData(): Promise<void> {
  await prisma.$transaction([
    prisma.reminderLog.deleteMany(),
    prisma.expense.deleteMany(),
    prisma.maintenanceRecord.deleteMany(),
    prisma.handoverRecord.deleteMany(),
    prisma.depositRecord.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.billItem.deleteMany(),
    prisma.bill.deleteMany(),
    prisma.lease.deleteMany(),
    prisma.tenant.deleteMany(),
    prisma.room.deleteMany(),
    prisma.roomType.deleteMany(),
    prisma.building.deleteMany(),
  ]);
}

function classifyExpense(name: string, purpose: string): string {
  const text = `${name} ${purpose}`;
  if (/工资|人工|劳务/.test(text)) return '人工';
  if (/网费|宽带|垃圾费|物业|水费|电费|燃气费|保洁费/.test(text)) return '固定支出';
  return '耗材维修';
}

function extractExpenseRoom(
  property: PropertyName,
  name: string,
  purpose: string,
): { buildingName: string | null; sourceRoomNo: string | null } {
  const text = `${name} ${purpose}`.toUpperCase();
  if (property === '嘉定公寓') {
    const roomMatch = text.match(/([QRS])\s*[-－]?\s*(\d{3})(?!\d)/);
    if (roomMatch) {
      return { buildingName: `${roomMatch[1]}栋`, sourceRoomNo: `${roomMatch[1]}${roomMatch[2]}` };
    }
    const buildingMatch = text.match(/([QRS])\s*栋/);
    return {
      buildingName: buildingMatch ? `${buildingMatch[1]}栋` : null,
      sourceRoomNo: null,
    };
  }

  const roomMatch = text.match(/(?:^|\D)([23]\d{2})(?!\d)/);
  return {
    buildingName: '明远公寓',
    sourceRoomNo: roomMatch?.[1] ?? null,
  };
}

async function importHistory(
  ledgerRows: LedgerRow[],
  eventRows: EventRow[],
  expenseRows: RawCsvRow[],
  segments: LeaseSegment[],
  landlordId: number,
): Promise<ImportStats> {
  const stats: ImportStats = {
    buildings: 0,
    roomTypes: 0,
    rooms: 0,
    tenants: 0,
    leases: 0,
    activeLeases: 0,
    bills: 0,
    payments: 0,
    billItems: 0,
    depositReceives: 0,
    depositRefunds: 0,
    expenses: 0,
    commissionExpenses: 0,
    skippedEmptyRentRows: ledgerRows.filter((row) => positive(row.rent) === null).length,
    mergedBillRows: 0,
    unassignedDepositEvents: 0,
  };

  const buildingNames = ['Q栋', 'R栋', 'S栋', '明远公寓'];
  await prisma.building.createMany({
    data: buildingNames.map((name, sort) => ({ name, sort: sort + 1 })),
  });
  stats.buildings = buildingNames.length;
  const buildings = await prisma.building.findMany();
  const buildingByName = new Map(buildings.map((building) => [building.name, building]));

  const segmentsByRoom = new Map<string, LeaseSegment[]>();
  for (const segment of segments) {
    const key = roomKey(segment.property, segment.sourceRoomNo);
    const values = segmentsByRoom.get(key) ?? [];
    values.push(segment);
    segmentsByRoom.set(key, values);
  }

  const roomSources = new Map<string, { property: PropertyName; sourceRoomNo: string }>();
  for (const row of [...ledgerRows, ...eventRows]) {
    roomSources.set(roomKey(row.property, row.sourceRoomNo), {
      property: row.property,
      sourceRoomNo: row.sourceRoomNo,
    });
  }

  const latestRoomRents = new Map<string, number>();
  const latestRoomDeposits = new Map<string, number>();
  for (const [key, roomSegments] of segmentsByRoom) {
    const latest = roomSegments.at(-1);
    if (!latest) continue;
    const rent = getSegmentRent(latest);
    const deposit = getSegmentDeposit(latest);
    if (rent > 0) latestRoomRents.set(key, rent);
    if (deposit > 0) latestRoomDeposits.set(key, deposit);
  }

  const roomValuesByBuilding = new Map<string, { rents: number[]; deposits: number[] }>();
  for (const [key, source] of roomSources) {
    const identity = getRoomIdentity(source.property, source.sourceRoomNo);
    const values = roomValuesByBuilding.get(identity.buildingName) ?? { rents: [], deposits: [] };
    const rent = latestRoomRents.get(key);
    const deposit = latestRoomDeposits.get(key);
    if (rent) values.rents.push(rent);
    if (deposit) values.deposits.push(deposit);
    roomValuesByBuilding.set(identity.buildingName, values);
  }

  for (const buildingName of buildingNames) {
    const values = roomValuesByBuilding.get(buildingName) ?? { rents: [], deposits: [] };
    await prisma.roomType.create({
      data: {
        name: `${buildingName}通用房型`,
        description: '历史数据导入通用房型；房间实际租金以 rentOverride 为准',
        defaultRent: median(values.rents),
        defaultDeposit: median(values.deposits),
        defaultPayCycle: 'MONTHLY',
      },
    });
    stats.roomTypes++;
  }
  const roomTypes = await prisma.roomType.findMany();
  const roomTypeByName = new Map(roomTypes.map((roomType) => [roomType.name, roomType]));

  const roomData: Prisma.RoomCreateManyInput[] = [];
  for (const [key, source] of roomSources) {
    const identity = getRoomIdentity(source.property, source.sourceRoomNo);
    const building = buildingByName.get(identity.buildingName);
    const roomType = roomTypeByName.get(`${identity.buildingName}通用房型`);
    if (!building || !roomType) throw new Error(`楼栋或房型不存在：${identity.buildingName}`);
    const latestSegment = segmentsByRoom.get(key)?.at(-1);
    const active =
      latestSegment !== undefined &&
      !latestSegment.endedByDeparture &&
      getLatestSourceMonth(latestSegment) >= addMonths(DATASET_LATEST_MONTH, -1);
    roomData.push({
      buildingId: building.id,
      roomNo: identity.roomNo,
      floor: identity.floor,
      roomTypeId: roomType.id,
      status: active ? 'RENTED' : 'VACANT',
      rentOverride: latestRoomRents.get(key) ?? null,
      remark: `历史导入原房号：${source.sourceRoomNo}`,
    });
  }
  const roomCreateResult = await prisma.room.createMany({ data: roomData });
  stats.rooms = roomCreateResult.count;
  const rooms = await prisma.room.findMany({ include: { building: true } });
  const roomBySourceKey = new Map<string, (typeof rooms)[number]>();
  for (const room of rooms) {
    const prefix = room.building.name === '明远公寓' ? '' : room.building.name.slice(0, 1);
    const property: PropertyName = room.building.name === '明远公寓' ? '明远公寓' : '嘉定公寓';
    roomBySourceKey.set(roomKey(property, `${prefix}${room.roomNo}`), room);
  }

  let inviteSequence = 0;
  const segmentToLeaseId = new Map<LeaseSegment, number>();
  for (const [key, roomSegments] of segmentsByRoom) {
    const room = roomBySourceKey.get(key);
    if (!room) throw new Error(`导入房间不存在：${key}`);

    for (let segmentIndex = 0; segmentIndex < roomSegments.length; segmentIndex++) {
      const segment = roomSegments[segmentIndex];
      const tenantLabel = `${segment.sourceRoomNo}历史租客${segmentIndex + 1}`;
      const tenant = await prisma.tenant.create({
        data: {
          name: tenantLabel,
          phone: `历史占位-${segment.property}-${segment.sourceRoomNo}-${segmentIndex + 1}`,
        },
      });
      stats.tenants++;

      const { startDate, endDate } = getSegmentDates(
        segment,
        roomSegments[segmentIndex + 1],
      );
      const isLatest = segmentIndex === roomSegments.length - 1;
      const isActive =
        isLatest &&
        !segment.endedByDeparture &&
        getLatestSourceMonth(segment) >= addMonths(DATASET_LATEST_MONTH, -1);
      const carPlate = [...segment.rows].reverse().find((row) => row.plate)?.plate || null;
      const endReason = segment.endReasons.length > 0 ? segment.endReasons.join('\n') : null;
      const lease = await prisma.lease.create({
        data: {
          roomId: room.id,
          tenantId: tenant.id,
          startDate,
          endDate,
          rent: getSegmentRent(segment),
          deposit: getSegmentDeposit(segment),
          payCycle: 'MONTHLY',
          carPlate,
          status: isActive ? 'ACTIVE' : 'ENDED',
          inviteCode: `HIST2608${(++inviteSequence).toString(36).toUpperCase().padStart(6, '0')}`,
          endedAt: isActive ? null : getLatestSourceMonth(segment),
          endReason,
        },
      });
      segmentToLeaseId.set(segment, lease.id);
      stats.leases++;
      if (isActive) stats.activeLeases++;

      const billGroups = new Map<string, LedgerRow[]>();
      for (const row of segment.rows) {
        if (positive(row.rent) === null) continue;
        const billKey = formatDate(row.periodStart);
        const group = billGroups.get(billKey) ?? [];
        group.push(row);
        billGroups.set(billKey, group);
      }

      for (const group of billGroups.values()) {
        const rentAmount = group.reduce((sum, row) => sum + (positive(row.rent) ?? 0), 0);
        const parkingAmount = group.reduce(
          (sum, row) => sum + (positive(row.parkingFee) ?? 0),
          0,
        );
        const totalAmount = rentAmount + parkingAmount;
        const periodStart = new Date(Math.min(...group.map((row) => row.periodStart.getTime())));
        const periodEnd = new Date(Math.max(...group.map((row) => row.periodEnd.getTime())));
        const paidAt = new Date(Math.max(...group.map((row) => row.sourceMonth.getTime())));
        const items: Prisma.BillItemCreateWithoutBillInput[] = [
          { type: 'RENT', name: '租金', amount: rentAmount },
        ];
        if (parkingAmount > 0) items.push({ type: 'FEE', name: '停车费', amount: parkingAmount });

        await prisma.bill.create({
          data: {
            leaseId: lease.id,
            periodStart,
            periodEnd,
            dueDate: periodStart,
            status: 'PAID',
            totalAmount,
            items: { create: items },
            payments: {
              create: {
                channel: 'TRANSFER',
                amount: totalAmount,
                status: 'CONFIRMED',
                paidAt,
                confirmedBy: landlordId,
                confirmedAt: paidAt,
              },
            },
          },
        });
        stats.bills++;
        stats.payments++;
        stats.billItems += items.length;
        stats.mergedBillRows += group.length - 1;
      }
    }
  }

  const allDepositRows: Array<{ row: BaseRentRow; segment: LeaseSegment }> = [];
  for (const segment of segments) {
    for (const row of [...segment.rows, ...segment.events]) allDepositRows.push({ row, segment });
  }
  const assignedRows = new Set<BaseRentRow>(allDepositRows.map(({ row }) => row));
  for (const row of [...ledgerRows, ...eventRows]) {
    if (
      (positive(row.newDeposit) !== null || positive(row.depositRefund) !== null) &&
      !assignedRows.has(row)
    ) {
      stats.unassignedDepositEvents++;
    }
  }

  const depositData: Prisma.DepositRecordCreateManyInput[] = [];
  for (const { row, segment } of allDepositRows) {
    const leaseId = segmentToLeaseId.get(segment);
    if (!leaseId) throw new Error('押金事件对应租约不存在');
    const reason = [
      `历史导入，来源 ${row.sheet}`,
      row.remark || null,
    ]
      .filter(Boolean)
      .join('；');
    const newDeposit = positive(row.newDeposit);
    const depositRefund = positive(row.depositRefund);
    if (newDeposit !== null) {
      depositData.push({
        leaseId,
        type: 'RECEIVE',
        amount: newDeposit,
        reason,
        operatorId: landlordId,
        createdAt: sourceMonthTimestamp(row),
      });
      stats.depositReceives++;
    }
    if (depositRefund !== null) {
      depositData.push({
        leaseId,
        type: 'REFUND',
        amount: depositRefund,
        reason,
        operatorId: landlordId,
        createdAt: sourceMonthTimestamp(row),
      });
      stats.depositRefunds++;
    }
  }
  if (depositData.length > 0) await prisma.depositRecord.createMany({ data: depositData });

  const expenseData: Prisma.ExpenseCreateManyInput[] = [];
  for (const row of ledgerRows) {
    const amount = positive(row.commission);
    if (amount === null) continue;

    const room = roomBySourceKey.get(roomKey(row.property, row.sourceRoomNo));
    if (!room) {
      throw new Error(`佣金支出对应房间不存在：${row.property}/${row.sourceRoomNo}`);
    }
    expenseData.push({
      date: row.periodStart,
      category: '中介佣金',
      name: '中介佣金',
      amount,
      remark: `历史导入，来源 ${row.sheet}`,
      buildingId: room.buildingId,
      roomId: room.id,
      operatorId: landlordId,
    });
    stats.commissionExpenses++;
  }

  for (const [index, row] of expenseRows.entries()) {
    const property = asPropertyName(row.property);
    const amount = Number(row.amount);
    if (!row.name || !row.amount.trim() || !Number.isFinite(amount) || amount <= 0) {
      console.warn(`⚠️ 跳过无效支出第 ${index + 2} 行：${row.name}/${row.amount}`);
      continue;
    }
    const location = extractExpenseRoom(property, row.name, row.purpose);
    const building = location.buildingName ? buildingByName.get(location.buildingName) : null;
    const room = location.sourceRoomNo
      ? roomBySourceKey.get(roomKey(property, location.sourceRoomNo))
      : null;
    expenseData.push({
      date: parseDate(row.date.slice(0, 10)),
      category: classifyExpense(row.name, row.purpose),
      name: row.name,
      amount,
      remark: row.purpose || null,
      buildingId: building?.id ?? null,
      roomId: room?.id ?? null,
      operatorId: landlordId,
    });
  }
  if (expenseData.length > 0) await prisma.expense.createMany({ data: expenseData });
  stats.expenses = expenseData.length;

  return stats;
}

async function main(): Promise<void> {
  loadLocalEnv();
  assertLocalDatabase();

  const dataDir = getDataDir();
  console.log(`📂 数据目录：${dataDir}`);
  const rawLedgerRows = parseCsv(path.join(dataDir, 'rent_ledger_final.csv'));
  const rawEventRows = parseCsv(path.join(dataDir, 'rent_events_no_period.csv'));
  const rawExpenseRows = parseCsv(path.join(dataDir, 'expenses_clean.csv'));
  requireHeaders(
    rawLedgerRows,
    [
      'room',
      'deposit',
      'rent',
      'new_deposit',
      'deposit_refund',
      'parking_fee',
      'commission',
      'period_start',
      'period_end',
      'remark',
      'sheet',
      'property',
    ],
    'rent_ledger_final.csv',
  );
  requireHeaders(rawEventRows, ['room', 'deposit_refund', 'remark', 'sheet', 'property'], 'rent_events_no_period.csv');
  requireHeaders(rawExpenseRows, ['date', 'name', 'purpose', 'amount', 'property'], 'expenses_clean.csv');

  const sheetMonths = buildSheetMonthMap(rawLedgerRows);
  const ledgerRows = parseLedgerRows(rawLedgerRows, sheetMonths);
  const eventRows = parseEventRows(rawEventRows, sheetMonths);
  const { segments, lowConfidence } = splitLeases(ledgerRows, eventRows);
  const roomCount = new Set(
    [...ledgerRows, ...eventRows].map((row) => roomKey(row.property, row.sourceRoomNo)),
  ).size;
  console.log(
    `📊 预检完成：账期 ${ledgerRows.length} 行、无账期事件 ${eventRows.length} 行、支出 ${rawExpenseRows.length} 行、房间 ${roomCount} 间、租约分段 ${segments.length} 段`,
  );

  const landlords = await prisma.landlord.findMany({ orderBy: { id: 'asc' } });
  if (landlords.length === 0) {
    throw new Error('本地 Landlord 表为空；为避免伪造操作人，导入已停止且尚未清空任何数据');
  }
  const auditLogCountBefore = await prisma.auditLog.count();
  const countsBefore = await getCounts();
  console.log('🧾 清空前行数（Landlord/AuditLog 不会删除）：');
  console.table({ Landlord: landlords.length, AuditLog: auditLogCountBefore, ...countsBefore });

  await clearReplaceableData();
  console.log('🧹 旧种子/占位数据已清空（含 Bill/Tenant 外键依赖 ReminderLog）');

  const stats = await importHistory(
    ledgerRows,
    eventRows,
    rawExpenseRows,
    segments,
    landlords[0].id,
  );

  const countsAfter = await getCounts();
  const landlordCountAfter = await prisma.landlord.count();
  const auditLogCountAfter = await prisma.auditLog.count();
  if (landlordCountAfter !== landlords.length || auditLogCountAfter !== auditLogCountBefore) {
    throw new Error('保护校验失败：Landlord 或 AuditLog 行数发生变化');
  }

  console.log('\n✅ 历史数据导入完成：');
  console.table(stats);
  console.log('📋 导入后数据库行数：');
  console.table({ Landlord: landlordCountAfter, AuditLog: auditLogCountAfter, ...countsAfter });
  console.log(`\n⚠️ 低置信度切分点：${lowConfidence.length} 条`);
  for (const split of lowConfidence) {
    console.log(
      `- ${split.property}/${split.room}，来源月 ${split.sourceMonth}，账期开始 ${split.periodStart}：${split.reasons.join('；')}`,
    );
  }
  if (stats.unassignedDepositEvents > 0) {
    console.warn(`⚠️ 有 ${stats.unassignedDepositEvents} 条押金事件无法关联租约，请人工检查`);
  }
}

main()
  .catch((error: unknown) => {
    console.error('❌ 历史数据导入失败：', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
