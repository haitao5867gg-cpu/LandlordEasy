<template>
  <div>
    <van-nav-bar :title="`房间 ${room?.roomNo || ''}`" left-arrow @click-left="$router.back()">
      <template #right>
        <van-button v-if="room?.status === 'VACANT'" size="small" type="primary" @click="$router.push(`/leases/new?roomId=${room.id}`)">新签租约</van-button>
      </template>
    </van-nav-bar>
    <van-loading v-if="loading" class="page-loading" />
    <template v-else-if="room">
      <van-cell-group inset title="基本信息">
        <van-cell title="楼栋" :value="room.building?.name" />
        <van-cell title="房号" :value="room.roomNo" />
        <van-cell title="楼层" :value="String(room.floor)" />
        <van-cell title="房型" :value="room.roomType?.name || '未设置'" />
        <van-cell title="状态">
          <template #value>
            <van-tag :type="room.status === 'RENTED' ? 'success' : 'default'">{{ statusMap[room.status] || room.status }}</van-tag>
          </template>
        </van-cell>
      </van-cell-group>

      <van-tabs v-model:active="activeTab">
        <van-tab title="租约">
          <van-empty v-if="!room.leases?.length" description="暂无租约" />
          <van-cell-group v-else inset>
            <van-cell
              v-for="lease in room.leases"
              :key="lease.id"
              :title="lease.tenant?.name"
              :label="`${lease.startDate?.split('T')[0]} ~ ${lease.endDate?.split('T')[0]}`"
              is-link
              @click="$router.push(`/leases/${lease.id}`)"
            >
              <template #value>
                <van-tag :type="lease.status === 'ACTIVE' ? 'success' : 'default'">{{ lease.status === 'ACTIVE' ? '在租' : '已退' }}</van-tag>
              </template>
            </van-cell>
          </van-cell-group>
        </van-tab>
        <van-tab title="维修记录">
          <van-empty v-if="!room.maintenanceRecords?.length" description="暂无记录" />
          <van-cell-group v-else inset>
            <van-cell v-for="m in room.maintenanceRecords" :key="m.id" :title="m.content" :label="m.date?.split('T')[0]" :value="`¥${m.cost}`" />
          </van-cell-group>
        </van-tab>
        <van-tab title="支出">
          <van-empty v-if="!room.expenses?.length" description="暂无支出" />
          <van-cell-group v-else inset>
            <van-cell v-for="e in room.expenses" :key="e.id" :title="e.name" :label="e.date?.split('T')[0]" :value="`¥${e.amount}`" />
          </van-cell-group>
        </van-tab>
        <van-tab title="操作日志">
          <van-empty v-if="!room.auditLogs?.length" description="暂无日志" />
          <van-cell-group v-else inset>
            <van-cell v-for="log in room.auditLogs" :key="log.id" :title="log.action" :label="log.createdAt?.replace('T',' ').slice(0,19)" />
          </van-cell-group>
        </van-tab>
      </van-tabs>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import http from '../../utils/http';
import { roomStatusMap } from '../../utils/status';

const route = useRoute();
const room = ref<any>(null);
const loading = ref(true);
const activeTab = ref(0);
const statusMap = roomStatusMap;

onMounted(async () => {
  try {
    room.value = await http.get(`/rooms/${route.params.id}`);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.page-loading { display: flex; justify-content: center; padding: 60px; }
</style>
