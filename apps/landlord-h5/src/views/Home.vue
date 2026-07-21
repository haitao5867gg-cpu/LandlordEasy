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
import { ref, onMounted } from 'vue';
import http from '../utils/http';

const loading = ref(true);
const vacantCount = ref(0);
const expiringCount = ref(0);
const overdueCount = ref(0);
const pendingCount = ref(0);

onMounted(async () => {
  try {
    const [vacancy, expiring, overdue, pending] = await Promise.all([
      http.get('/dashboard/vacancy'),
      http.get('/dashboard/expiring'),
      http.get('/dashboard/overdue'),
      http.get('/payments/pending'),
    ]);
    vacantCount.value = (vacancy as any).total || 0;
    expiringCount.value = Array.isArray(expiring) ? expiring.length : 0;
    overdueCount.value = (overdue as any).total || 0;
    pendingCount.value = Array.isArray(pending) ? pending.length : 0;
  } catch {
    // handled by interceptor
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.home-page { padding-bottom: 60px; }
.page-loading { display: flex; justify-content: center; padding: 60px; }
.dashboard-cards { margin-top: 12px; }
.cell-icon { margin-right: 8px; font-size: 20px; }
</style>
