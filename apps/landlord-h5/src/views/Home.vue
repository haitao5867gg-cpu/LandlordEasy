<template>
  <div class="home-page">
    <van-nav-bar title="工作台" />
    <van-loading v-if="loading" class="page-loading" />
    <div v-else class="dashboard-cards">
      <van-cell-group inset>
        <van-cell
          title="空置房间"
          :value="String(vacantCount)"
          is-link
          @click="$router.push('/dashboard/vacancy')"
        >
          <template #icon><van-icon name="shop-o" class="cell-icon" /></template>
        </van-cell>
        <van-cell
          title="30天内到期"
          :value="String(expiringCount)"
          is-link
          @click="$router.push('/dashboard/expiring')"
        >
          <template #icon><van-icon name="clock-o" class="cell-icon" /></template>
        </van-cell>
        <van-cell
          title="逾期账单"
          :value="String(overdueCount)"
          is-link
          @click="$router.push('/dashboard/overdue')"
        >
          <template #icon><van-icon name="warning-o" class="cell-icon" /></template>
        </van-cell>
        <van-cell
          title="待确认收款"
          :value="String(pendingCount)"
          is-link
          @click="$router.push('/payments/pending')"
        >
          <template #icon><van-icon name="gold-coin-o" class="cell-icon" /></template>
        </van-cell>
        <van-cell
          title="待处理申请"
          :value="String(applicationCount)"
          is-link
          @click="$router.push('/applications')"
        >
          <template #icon><van-icon name="todo-list-o" class="cell-icon" /></template>
        </van-cell>
      </van-cell-group>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import http from '../utils/http';
import { usePropertyStore } from '../stores/property';

const propertyStore = usePropertyStore();
const loading = ref(true);
const vacantCount = ref(0);
const expiringCount = ref(0);
const overdueCount = ref(0);
const pendingCount = ref(0);
const applicationCount = ref(0);

async function fetchDashboard() {
  loading.value = true;
  const params: Record<string, string> = {};
  if (propertyStore.currentPropertyId) params.propertyId = String(propertyStore.currentPropertyId);
  const [vacancy, expiring, overdue, pending, repair, termination, transfer] = await Promise.allSettled([
    http.get('/dashboard/vacancy', { params }),
    http.get('/dashboard/expiring', { params }),
    http.get('/dashboard/overdue', { params }),
    http.get('/payments/pending', { params }),
    http.get('/maintenance/repair-requests', { params: { status: 'SUBMITTED' } }),
    http.get('/leases/termination-requests', { params: { status: 'PENDING' } }),
    http.get('/leases/transfer-requests', { params: { status: 'PENDING' } }),
  ]);
  if (vacancy.status === 'fulfilled') vacantCount.value = (vacancy.value as any).total || 0;
  if (expiring.status === 'fulfilled') expiringCount.value = Array.isArray(expiring.value) ? expiring.value.length : 0;
  if (overdue.status === 'fulfilled') overdueCount.value = (overdue.value as any).total || 0;
  if (pending.status === 'fulfilled') pendingCount.value = Array.isArray(pending.value) ? pending.value.length : 0;
  applicationCount.value =
    (repair.status === 'fulfilled' && Array.isArray(repair.value) ? repair.value.length : 0) +
    (termination.status === 'fulfilled' && Array.isArray(termination.value) ? termination.value.length : 0) +
    (transfer.status === 'fulfilled' && Array.isArray(transfer.value) ? transfer.value.length : 0);
  loading.value = false;
}

onMounted(fetchDashboard);
watch(() => propertyStore.currentPropertyId, () => {
  fetchDashboard();
});
</script>

<style scoped>
.page-loading { display: flex; justify-content: center; padding: 60px; }
.dashboard-cards { margin-top: 12px; }
.cell-icon { margin-right: 8px; font-size: 20px; }
</style>
