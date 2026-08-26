/**
 * 一次性公寓/园区数据迁移脚本。
 *
 * 用途：创建“鸿翼人才公寓”和“明远公寓”，并把现有楼栋归入对应公寓。
 * 本脚本可安全重复执行；若目标公寓已存在，将直接跳过。
 *
 * 执行示例：
 * pnpm --filter server exec ts-node src/scripts/migrate-add-properties.ts --confirm-target=landlord_easy
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const ALLOWED_DATABASE_NAMES = new Set(['landlord_easy', 'landlordeasy_dev']);
const PROPERTY_NAMES = ['鸿翼人才公寓', '明远公寓'] as const;
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

async function main(): Promise<void> {
  loadLocalEnv();
  assertLocalDatabase();

  console.log('📋 将执行以下操作：');
  console.log('- 创建公寓“鸿翼人才公寓”（sort: 1）和“明远公寓”（sort: 2）');
  console.log('- 将 Q栋、R栋、S栋 归入“鸿翼人才公寓”');
  console.log('- 将楼栋“明远公寓”改名为“1号楼”，并归入“明远公寓”');

  const existingProperty = await prisma.property.findFirst({
    where: { name: { in: [...PROPERTY_NAMES] } },
  });
  if (existingProperty) {
    console.log('迁移已执行过,跳过');
    return;
  }

  await prisma.$transaction(async (tx) => {
    const hongyiProperty = await tx.property.create({
      data: { name: '鸿翼人才公寓', sort: 1 },
    });
    const mingyuanProperty = await tx.property.create({
      data: { name: '明远公寓', sort: 2 },
    });

    for (const buildingName of ['Q栋', 'R栋', 'S栋']) {
      const building = await tx.building.findUnique({ where: { name: buildingName } });
      if (!building) {
        throw new Error(`数据完整性检查失败：楼栋“${buildingName}”不存在`);
      }
      await tx.building.update({
        where: { id: building.id },
        data: { propertyId: hongyiProperty.id },
      });
    }

    const mingyuanBuilding = await tx.building.findUnique({ where: { name: '明远公寓' } });
    if (!mingyuanBuilding) {
      throw new Error('数据完整性检查失败：楼栋“明远公寓”不存在');
    }
    await tx.building.update({
      where: { id: mingyuanBuilding.id },
      data: { name: '1号楼', propertyId: mingyuanProperty.id },
    });
  });

  const unassignedBuildings = await prisma.building.findMany({
    where: { propertyId: null },
    orderBy: { sort: 'asc' },
    select: { name: true },
  });
  if (unassignedBuildings.length > 0) {
    console.warn(
      `⚠️ 仍有 ${unassignedBuildings.length} 栋楼未分配公寓：${unassignedBuildings.map((building) => building.name).join('、')}`,
    );
  }

  const properties = await prisma.property.findMany({
    where: { name: { in: [...PROPERTY_NAMES] } },
    orderBy: { sort: 'asc' },
    include: {
      buildings: {
        orderBy: { sort: 'asc' },
        select: { name: true },
      },
    },
  });

  console.log('\n✅ 公寓迁移完成：');
  for (const property of properties) {
    console.log(
      `- ${property.name}：${property.buildings.length} 栋（${property.buildings.map((building) => building.name).join('、') || '无'}）`,
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error('❌ 公寓迁移失败：', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
