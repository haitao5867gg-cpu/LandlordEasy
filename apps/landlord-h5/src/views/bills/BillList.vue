<template>
  <div class="bill-list-page">
    <van-nav-bar title="账单" />
    <van-tabs v-model:active="activeTab" @change="fetchBills">
      <van-tab title="全部" name="" />
      <van-tab title="待付" name="PENDING" />
      <van-tab title="已付" name="PAID" />
      <van-tab title="逾期" name="OVERDUE" />
    </van-tabs>
    <van-loading v-if="loading" class="page-loading" />
    <van-empty v-else-if="bills.length === 0" description="暂无账单" />
    <van-cell-group v-else inset>
      <van-cell
        v-for="bill in bills"
        :key="bill.id"
        :title="`${bill.lease?.room?.building?.name} ${bill.lease?.room?.roomNo} - ${bill.lease?.tenant?.name}`"
        :label="`${bill.periodStart?.split('T')[0]} ~ ${bill.periodEnd?.split('T')[0]}`"
        is-link
        @click="$router.push(`/bills/${bill.id}`)"
      >
        <template #value>
          <div>¥{{ bill.totalAmount }}</div>
          <van-tag size="medium" :type="tagType(bill.status)">{{ statusLabel(bill.status) }}</van-tag>
        </template>
      </van-cell>
    </van-cell-group>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import http from '../../utils/http';
import { billStatusMap } from '../../utils/status';

const bills = ref<any[]>([]);
const activeTab = ref('');
const loading = ref(true);

function statusLabel(s: string) { return billStatusMap[s] || s; }
function tagType(s: string) {
  if (s === 'PAID') return 'success';
  if (s === 'OVERDUE') return 'danger';
  return 'warning';
}

async function fetchBills() {
  loading.value = true;
  try {
    const params: Record<string, string> = {};
    if (activeTab.value) params.status = activeTab.value;
    bills.value = await http.get('/bills', { params }) as any;
  } finally { loading.value = false; }
}

onMounted(fetchBills);
</script>

<style scoped>
.bill-list-page { padding-bottom: 60px; }
.page-loading { display: flex; justify-content: center; padding: 60px; }
</style>
