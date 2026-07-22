/**
 * CSV 导入初始数据命令
 * 用法: pnpm --filter server import:init -- <csv-dir>
 *
 * 从指定目录读取标准 CSV 文件导入初始数据,幂等可重跑。
 * CSV 文件格式由 Claude 提供,存放于 data/import/ 目录。
 *
 * 支持的文件:
 * - buildings.csv: 楼栋(name, sort)
 * - room_types.csv: 房型(name, description, defaultRent, defaultDeposit, defaultPayCycle)
 * - rooms.csv: 房间(buildingName, roomNo, floor, roomTypeName)
 * - leases.csv: 租约(buildingName, roomNo, tenantName, tenantPhone, startDate, endDate, rent, deposit, payCycle)
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

function parseCsv(filePath: string): Record<string, string>[] {
  if (!fs.existsSync(filePath)) {
    console.log(`⏭️  文件不存在,跳过: ${filePath}`);
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(',').map((v) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = values[i] || ''));
    return row;
  });
}

async function importBuildings(csvDir: string) {
  const rows = parseCsv(path.join(csvDir, 'buildings.csv'));
  if (rows.length === 0) return;

  console.log(`📥 导入楼栋 (${rows.length} 条)...`);
  for (const row of rows) {
    await prisma.building.upsert({
      where: { name: row.name },
      update: { sort: parseInt(row.sort) || 0 },
      create: { name: row.name, sort: parseInt(row.sort) || 0 },
    });
  }
  console.log('✅ 楼栋导入完成');
}

async function importRoomTypes(csvDir: string) {
  const rows = parseCsv(path.join(csvDir, 'room_types.csv'));
  if (rows.length === 0) return;

  console.log(`📥 导入房型 (${rows.length} 条)...`);
  for (const row of rows) {
    await prisma.roomType.upsert({
      where: { name: row.name },
      update: {
        defaultRent: parseFloat(row.defaultRent) || 0,
        defaultDeposit: parseFloat(row.defaultDeposit) || 0,
        defaultPayCycle: row.defaultPayCycle || 'MONTHLY',
      },
      create: {
        name: row.name,
        description: row.description || null,
        defaultRent: parseFloat(row.defaultRent) || 0,
        defaultDeposit: parseFloat(row.defaultDeposit) || 0,
        defaultPayCycle: row.defaultPayCycle || 'MONTHLY',
      },
    });
  }
  console.log('✅ 房型导入完成');
}

async function importRooms(csvDir: string) {
  const rows = parseCsv(path.join(csvDir, 'rooms.csv'));
  if (rows.length === 0) return;

  console.log(`📥 导入房间 (${rows.length} 条)...`);
  for (const row of rows) {
    const building = await prisma.building.findUnique({ where: { name: row.buildingName } });
    if (!building) {
      console.warn(`⚠️  楼栋不存在: ${row.buildingName},跳过房间 ${row.roomNo}`);
      continue;
    }
    const roomType = row.roomTypeName
      ? await prisma.roomType.findUnique({ where: { name: row.roomTypeName } })
      : null;

    await prisma.room.upsert({
      where: { buildingId_roomNo: { buildingId: building.id, roomNo: row.roomNo } },
      update: { floor: parseInt(row.floor) || 1, roomTypeId: roomType?.id || null },
      create: {
        buildingId: building.id,
        roomNo: row.roomNo,
        floor: parseInt(row.floor) || 1,
        roomTypeId: roomType?.id || null,
        status: 'VACANT',
      },
    });
  }
  console.log('✅ 房间导入完成');
}

async function importLeases(csvDir: string) {
  const rows = parseCsv(path.join(csvDir, 'leases.csv'));
  if (rows.length === 0) return;

  // 需要一个 operatorId 来创建 DepositRecord,取第一个房东
  const firstLandlord = await prisma.landlord.findFirst();
  const operatorId = firstLandlord?.id || 1;

  console.log(`📥 导入租约 (${rows.length} 条)...`);
  let created = 0;
  for (const row of rows) {
    const building = await prisma.building.findUnique({ where: { name: row.buildingName } });
    if (!building) continue;

    const room = await prisma.room.findUnique({
      where: { buildingId_roomNo: { buildingId: building.id, roomNo: row.roomNo } },
    });
    if (!room) {
      console.warn(`⚠️  房间不存在: ${row.buildingName}-${row.roomNo},跳过`);
      continue;
    }

    // 查找或创建租客
    const tenantName = row.tenantName || `租客_${row.buildingName}${row.roomNo}`;
    const tenantPhone = row.tenantPhone || `未知_${row.roomNo}`;
    let tenant = await prisma.tenant.findFirst({ where: { phone: tenantPhone } });
    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: { name: tenantName, phone: tenantPhone },
      });
    }

    // 检查是否已有此租约(幂等:相同 room+tenant+startDate)
    const existing = await prisma.lease.findFirst({
      where: {
        roomId: room.id,
        tenantId: tenant.id,
        startDate: new Date(row.startDate),
      },
    });
    if (existing) continue;

    // 构建 feeItems:如果有 parkingFee 则加入
    const feeItems: { name: string; amount: number }[] = [];
    const parkingFee = parseFloat(row.parkingFee);
    if (parkingFee > 0) {
      feeItems.push({ name: '停车费', amount: parkingFee });
    }

    const inviteCode = Math.random().toString(36).substring(2, 10).toUpperCase();
    const deposit = parseFloat(row.deposit) || 0;

    const lease = await prisma.lease.create({
      data: {
        roomId: room.id,
        tenantId: tenant.id,
        startDate: new Date(row.startDate),
        endDate: new Date(row.endDate),
        rent: parseFloat(row.rent) || 0,
        deposit,
        payCycle: row.payCycle || 'MONTHLY',
        carPlate: row.carPlate || null,
        feeItems: feeItems.length > 0 ? JSON.parse(JSON.stringify(feeItems)) : undefined,
        status: 'ACTIVE',
        inviteCode,
      },
    });

    // 创建押金收取记录(9.6)
    if (deposit > 0) {
      await prisma.depositRecord.create({
        data: {
          leaseId: lease.id,
          type: 'RECEIVE',
          amount: deposit,
          operatorId,
        },
      });
    }

    // 房间标记已租
    await prisma.room.update({ where: { id: room.id }, data: { status: 'RENTED' } });
    created++;
  }
  console.log(`✅ 租约导入完成(新增 ${created} 条,含押金记录)`);
}

async function importExpenses(csvDir: string) {
  const rows = parseCsv(path.join(csvDir, 'expenses.csv'));
  if (rows.length === 0) return;

  const firstLandlord = await prisma.landlord.findFirst();
  const operatorId = firstLandlord?.id || 1;

  console.log(`📥 导入支出 (${rows.length} 条)...`);
  let created = 0;
  for (const row of rows) {
    const date = new Date(row.date);
    const amount = parseFloat(row.amount) || 0;
    if (!row.name || amount <= 0) continue;

    // 可选关联楼栋/房间
    let buildingId: number | null = null;
    let roomId: number | null = null;

    if (row.buildingName) {
      const building = await prisma.building.findUnique({ where: { name: row.buildingName } });
      if (building) {
        buildingId = building.id;
        if (row.roomNo) {
          const room = await prisma.room.findUnique({
            where: { buildingId_roomNo: { buildingId: building.id, roomNo: row.roomNo } },
          });
          if (room) roomId = room.id;
        }
      }
    }

    // 幂等:相同日期+名称+金额视为重复
    const existing = await prisma.expense.findFirst({
      where: { date, name: row.name, amount },
    });
    if (existing) continue;

    await prisma.expense.create({
      data: {
        date,
        category: row.category || '其他',
        name: row.name,
        amount,
        remark: row.remark || null,
        buildingId,
        roomId,
        operatorId,
      },
    });
    created++;
  }
  console.log(`✅ 支出导入完成(新增 ${created} 条)`);
}

async function main() {
  const csvDir = process.argv[2] || path.join(process.cwd(), 'data/import');
  console.log(`🚀 开始 CSV 导入,数据目录: ${csvDir}`);

  if (!fs.existsSync(csvDir)) {
    console.error(`❌ 目录不存在: ${csvDir}`);
    console.log('用法: pnpm --filter server import:init -- <csv-dir>');
    process.exit(1);
  }

  await importBuildings(csvDir);
  await importRoomTypes(csvDir);
  await importRooms(csvDir);
  await importLeases(csvDir);
  await importExpenses(csvDir);

  console.log('🎉 全部导入完成!');
}

main()
  .catch((e) => {
    console.error('❌ 导入失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
