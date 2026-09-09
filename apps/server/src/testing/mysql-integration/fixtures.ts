import { randomBytes } from 'crypto';
import { PrismaClient } from '@prisma/client';

/**
 * Collision-resistant synthetic fixtures for the REL-001 real-MySQL
 * integration harness. Every fixture embeds a unique run tag into every
 * unique-constrained field so parallel runs (or a retried run after a
 * previous failure was left in place for inspection) never collide.
 * Cleanup only ever deletes rows scoped to the exact IDs a fixture created —
 * no truncate, no global FK-disable, no schema drop, no broad `deleteMany`
 * without an id/leaseId/roomId filter tied to this fixture.
 */

export function fixtureRunTag(prefix: string): string {
  return `rel001-${prefix}-${Date.now()}-${randomBytes(4).toString('hex')}`;
}

function dateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function addYears(date: Date, years: number): Date {
  const result = new Date(date);
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

function tagPhone(tag: string): string {
  const digits = Array.from(tag)
    .map((char) => char.charCodeAt(0) % 10)
    .join('')
    .padEnd(9, '0')
    .slice(-9);
  return `138${digits}`;
}

export interface TerminationFixture {
  tag: string;
  landlordId: number;
  propertyId: number;
  buildingId: number;
  roomId: number;
  tenantId: number;
  leaseId: number;
  requestId: number;
  cleanup(): Promise<void>;
}

export async function createTerminationFixture(
  client: PrismaClient,
  opts: { deposit: number; rent: number; suggestedPenalty: number },
): Promise<TerminationFixture> {
  const tag = fixtureRunTag('term');
  const landlord = await client.landlord.create({
    data: { openid: `${tag}-landlord`, name: `${tag}-landlord` },
  });
  const property = await client.property.create({ data: { name: `${tag}-property` } });
  const building = await client.building.create({
    data: { name: `${tag}-building`, propertyId: property.id },
  });
  const room = await client.room.create({
    data: { buildingId: building.id, roomNo: `${tag}-room`, floor: 1, status: 'RENTED' },
  });
  const tenant = await client.tenant.create({
    data: { name: `${tag}-tenant`, phone: tagPhone(tag) },
  });
  const now = dateOnly(new Date());
  const lease = await client.lease.create({
    data: {
      roomId: room.id,
      tenantId: tenant.id,
      startDate: addDays(now, -30),
      endDate: addYears(now, 1),
      rent: opts.rent,
      deposit: opts.deposit,
      inviteCode: tag,
      status: 'ACTIVE',
    },
  });
  await client.depositRecord.create({
    data: { leaseId: lease.id, type: 'RECEIVE', amount: opts.deposit, operatorId: landlord.id },
  });
  const request = await client.leaseTerminationRequest.create({
    data: {
      leaseId: lease.id,
      tenantId: tenant.id,
      requestedMoveOutDate: now,
      status: 'PENDING',
      suggestedPenalty: opts.suggestedPenalty,
    },
  });

  return {
    tag,
    landlordId: landlord.id,
    propertyId: property.id,
    buildingId: building.id,
    roomId: room.id,
    tenantId: tenant.id,
    leaseId: lease.id,
    requestId: request.id,
    async cleanup() {
      await client.depositRecord.deleteMany({ where: { leaseId: lease.id } });
      await client.billItem.deleteMany({ where: { bill: { leaseId: lease.id } } });
      await client.bill.deleteMany({ where: { leaseId: lease.id } });
      await client.leaseTerminationRequest.deleteMany({ where: { leaseId: lease.id } });
      await client.contractSigningTask.deleteMany({ where: { leaseId: lease.id } });
      await client.lease.delete({ where: { id: lease.id } });
      await client.room.delete({ where: { id: room.id } });
      await client.building.delete({ where: { id: building.id } });
      await client.property.delete({ where: { id: property.id } });
      await client.tenant.delete({ where: { id: tenant.id } });
      await client.landlord.delete({ where: { id: landlord.id } });
    },
  };
}

export interface TransferFixture {
  tag: string;
  landlordId: number;
  propertyId: number;
  buildingId: number;
  oldRoomId: number;
  targetRoomId: number;
  tenantId: number;
  oldLeaseId: number;
  requestId: number;
  cleanup(): Promise<void>;
}

export async function createTransferFixture(
  client: PrismaClient,
  opts: { oldDeposit: number; oldRent: number },
): Promise<TransferFixture> {
  const tag = fixtureRunTag('transfer');
  const landlord = await client.landlord.create({
    data: { openid: `${tag}-landlord`, name: `${tag}-landlord` },
  });
  const property = await client.property.create({ data: { name: `${tag}-property` } });
  const building = await client.building.create({
    data: { name: `${tag}-building`, propertyId: property.id },
  });
  const oldRoom = await client.room.create({
    data: { buildingId: building.id, roomNo: `${tag}-old`, floor: 1, status: 'RENTED' },
  });
  const targetRoom = await client.room.create({
    data: { buildingId: building.id, roomNo: `${tag}-target`, floor: 2, status: 'VACANT' },
  });
  const tenant = await client.tenant.create({
    data: { name: `${tag}-tenant`, phone: tagPhone(tag), idCard: '310101199001011234' },
  });
  const now = dateOnly(new Date());
  const oldLease = await client.lease.create({
    data: {
      roomId: oldRoom.id,
      tenantId: tenant.id,
      startDate: addDays(now, -30),
      endDate: addYears(now, 1),
      rent: opts.oldRent,
      deposit: opts.oldDeposit,
      inviteCode: `${tag}-old`,
      status: 'ACTIVE',
    },
  });
  const request = await client.roomTransferRequest.create({
    data: { leaseId: oldLease.id, tenantId: tenant.id, status: 'PENDING' },
  });

  return {
    tag,
    landlordId: landlord.id,
    propertyId: property.id,
    buildingId: building.id,
    oldRoomId: oldRoom.id,
    targetRoomId: targetRoom.id,
    tenantId: tenant.id,
    oldLeaseId: oldLease.id,
    requestId: request.id,
    async cleanup() {
      const currentRequest = await client.roomTransferRequest.findUnique({
        where: { id: request.id },
      });
      const leaseIds = [oldLease.id, ...(currentRequest?.newLeaseId ? [currentRequest.newLeaseId] : [])];
      await client.depositRecord.deleteMany({ where: { leaseId: { in: leaseIds } } });
      await client.billItem.deleteMany({ where: { bill: { leaseId: { in: leaseIds } } } });
      await client.bill.deleteMany({ where: { leaseId: { in: leaseIds } } });
      await client.contractSigningTask.deleteMany({ where: { leaseId: { in: leaseIds } } });
      await client.roomTransferRequest.deleteMany({ where: { id: request.id } });
      await client.lease.deleteMany({ where: { id: { in: leaseIds } } });
      await client.room.deleteMany({ where: { id: { in: [oldRoom.id, targetRoom.id] } } });
      await client.building.delete({ where: { id: building.id } });
      await client.property.delete({ where: { id: property.id } });
      await client.tenant.delete({ where: { id: tenant.id } });
      await client.landlord.delete({ where: { id: landlord.id } });
    },
  };
}

/** Second independent old-lease/tenant pair sharing an existing target room, for competing-applicant tests. */
export async function createCompetingOldLease(
  client: PrismaClient,
  building: { id: number },
  opts: { oldDeposit: number; oldRent: number },
): Promise<{
  tag: string;
  tenantId: number;
  oldRoomId: number;
  oldLeaseId: number;
  requestId: number;
  cleanup(): Promise<void>;
}> {
  const tag = fixtureRunTag('competitor');
  const oldRoom = await client.room.create({
    data: { buildingId: building.id, roomNo: `${tag}-old`, floor: 3, status: 'RENTED' },
  });
  const tenant = await client.tenant.create({
    data: { name: `${tag}-tenant`, phone: tagPhone(tag), idCard: '310101199001011235' },
  });
  const now = dateOnly(new Date());
  const oldLease = await client.lease.create({
    data: {
      roomId: oldRoom.id,
      tenantId: tenant.id,
      startDate: addDays(now, -30),
      endDate: addYears(now, 1),
      rent: opts.oldRent,
      deposit: opts.oldDeposit,
      inviteCode: `${tag}-old`,
      status: 'ACTIVE',
    },
  });
  const request = await client.roomTransferRequest.create({
    data: { leaseId: oldLease.id, tenantId: tenant.id, status: 'PENDING' },
  });

  return {
    tag,
    tenantId: tenant.id,
    oldRoomId: oldRoom.id,
    oldLeaseId: oldLease.id,
    requestId: request.id,
    async cleanup() {
      const currentRequest = await client.roomTransferRequest.findUnique({
        where: { id: request.id },
      });
      const leaseIds = [oldLease.id, ...(currentRequest?.newLeaseId ? [currentRequest.newLeaseId] : [])];
      await client.depositRecord.deleteMany({ where: { leaseId: { in: leaseIds } } });
      await client.contractSigningTask.deleteMany({ where: { leaseId: { in: leaseIds } } });
      await client.roomTransferRequest.deleteMany({ where: { id: request.id } });
      await client.lease.deleteMany({ where: { id: { in: leaseIds } } });
      await client.room.delete({ where: { id: oldRoom.id } });
      await client.tenant.delete({ where: { id: tenant.id } });
    },
  };
}

export interface RoomPairFixture {
  tag: string;
  propertyId: number;
  buildingId: number;
  roomAId: number;
  roomBId: number;
  cleanup(): Promise<void>;
}

/** Two plain rooms with no lease, used only to prove real row-lock waiting/deadlock behavior. */
export async function createRoomPairFixture(client: PrismaClient): Promise<RoomPairFixture> {
  const tag = fixtureRunTag('lockpair');
  const property = await client.property.create({ data: { name: `${tag}-property` } });
  const building = await client.building.create({
    data: { name: `${tag}-building`, propertyId: property.id },
  });
  const roomA = await client.room.create({ data: { buildingId: building.id, roomNo: `${tag}-a`, floor: 1 } });
  const roomB = await client.room.create({ data: { buildingId: building.id, roomNo: `${tag}-b`, floor: 1 } });

  return {
    tag,
    propertyId: property.id,
    buildingId: building.id,
    roomAId: roomA.id,
    roomBId: roomB.id,
    async cleanup() {
      await client.room.deleteMany({ where: { id: { in: [roomA.id, roomB.id] } } });
      await client.building.delete({ where: { id: building.id } });
      await client.property.delete({ where: { id: property.id } });
    },
  };
}

export interface RepairFixture {
  tag: string;
  landlordId: number;
  propertyId: number;
  buildingId: number;
  roomId: number;
  tenantId: number;
  leaseId: number;
  repairRequestId: number;
  cleanup(): Promise<void>;
}

export async function createRepairFixture(client: PrismaClient): Promise<RepairFixture> {
  const tag = fixtureRunTag('repair');
  const landlord = await client.landlord.create({
    data: { openid: `${tag}-landlord`, name: `${tag}-landlord` },
  });
  const property = await client.property.create({ data: { name: `${tag}-property` } });
  const building = await client.building.create({
    data: { name: `${tag}-building`, propertyId: property.id },
  });
  const room = await client.room.create({
    data: { buildingId: building.id, roomNo: `${tag}-room`, floor: 1, status: 'RENTED' },
  });
  const tenant = await client.tenant.create({
    data: { name: `${tag}-tenant`, phone: tagPhone(tag) },
  });
  const now = dateOnly(new Date());
  const lease = await client.lease.create({
    data: {
      roomId: room.id,
      tenantId: tenant.id,
      startDate: addDays(now, -30),
      endDate: addYears(now, 1),
      rent: 1800,
      deposit: 1800,
      inviteCode: tag,
      status: 'ACTIVE',
    },
  });
  const repairRequest = await client.repairRequest.create({
    data: {
      leaseId: lease.id,
      tenantId: tenant.id,
      roomId: room.id,
      description: `${tag}-description`,
      status: 'IN_PROGRESS',
    },
  });

  return {
    tag,
    landlordId: landlord.id,
    propertyId: property.id,
    buildingId: building.id,
    roomId: room.id,
    tenantId: tenant.id,
    leaseId: lease.id,
    repairRequestId: repairRequest.id,
    async cleanup() {
      await client.maintenanceRecord.deleteMany({ where: { roomId: room.id } });
      await client.repairRequest.deleteMany({ where: { id: repairRequest.id } });
      await client.lease.delete({ where: { id: lease.id } });
      await client.room.delete({ where: { id: room.id } });
      await client.building.delete({ where: { id: building.id } });
      await client.property.delete({ where: { id: property.id } });
      await client.tenant.delete({ where: { id: tenant.id } });
      await client.landlord.delete({ where: { id: landlord.id } });
    },
  };
}
