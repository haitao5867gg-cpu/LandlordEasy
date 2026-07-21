<template>
  <div class="room-list-page">
    <van-nav-bar title="房间管理">
      <template #right>
        <van-icon name="plus" size="20" @click="$router.push('/rooms/batch-create')" />
      </template>
    </van-nav-bar>
    <van-tabs v-model:active="activeBuilding" @change="fetchRooms">
      <van-tab title="全部" :name="0" />
      <van-tab v-for="b in buildings" :key="b.id" :title="b.name" :name="b.id" />
    </van-tabs>
    <van-dropdown-menu>
      <van-dropdown-item v-model="statusFilter" :options="statusOptions" @change="fetchRooms" />
    </van-dropdown-menu>
    <van-loading v-if="loading" class="page-loading" />
    <van-empty v-else-if="rooms.length === 0" description="暂无房间" />
    <van-cell-group v-else inset>
      <van-cell
        v-for="room in rooms"
        :key="room.id"
        :title="`${room.roomNo}`"
        :label="room.roomType?.name || ''"
        is-link
        @click="$router.push(`/rooms/${room.id}`)"
      >
        <template #value>
          <van-tag :type="statusTagType(room.status)">{{ statusLabel(room.status) }}</van-tag>
        </template>
      </van-cell>
    </van-cell-group>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import http from '../../utils/http';
import { roomStatusMap } from '../../utils/status';

const buildings = ref<any[]>([]);
const rooms = ref<any[]>([]);
const activeBuilding = ref(0);
const statusFilter = ref('');
const loading = ref(true);

const statusOptions = [
  { text: '全部状态', value: '' },
  { text: '空置', value: 'VACANT' },
  { text: '已租', value: 'RENTED' },
  { text: '维修中', value: 'MAINTENANCE' },
];

function statusLabel(s: string) { return roomStatusMap[s] || s; }
function statusTagType(s: string) {
  if (s === 'VACANT') return 'default';
  if (s === 'RENTED') return 'success';
  return 'warning';
}

async function fetchRooms() {
  loading.value = true;
  try {
    const params: Record<string, string> = {};
    if (activeBuilding.value) params.buildingId = String(activeBuilding.value);
    if (statusFilter.value) params.status = statusFilter.value;
    rooms.value = await http.get('/rooms', { params }) as any;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  buildings.value = await http.get('/buildings') as any;
  await fetchRooms();
});
</script>

<style scoped>
.room-list-page { padding-bottom: 60px; }
.page-loading { display: flex; justify-content: center; padding: 60px; }
</style>
