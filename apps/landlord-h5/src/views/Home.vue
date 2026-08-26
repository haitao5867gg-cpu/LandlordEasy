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

async function fetchDashboard() {
  loading.value = true;
  const params: Record<string, string> = {};
  if (propertyStore.currentPropertyId) params.propertyId = String(propertyStore.currentPropertyId);
  const [vacancy, expiring, overdue, pending] = await Promise.allSettled([
    http.get('/dashboard/vacancy', { params }),
    http.get('/dashboard/expiring', { params }),
    http.get('/dashboard/overdue', { params }),
    http.get('/payments/pending', { params }),
  ]);
  if (vacancy.status === 'fulfilled') vacantCount.value = (vacancy.value as any).total || 0;
  if (expiring.status === 'fulfilled') expiringCount.value = Array.isArray(expiring.value) ? expiring.value.length : 0;
  if (overdue.status === 'fulfilled') overdueCount.value = (overdue.value as any).total || 0;
  if (pending.status === 'fulfilled') pendingCount.value = Array.isArray(pending.value) ? pending.value.length : 0;
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
