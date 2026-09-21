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
    <van-collapse v-else v-model="activeMonths" class="month-list">
      <van-collapse-item v-for="group in monthGroups" :key="group.month" :name="group.month">
        <template #title>
          <div class="month-card">
            <div class="month-title">
              <strong>{{ group.month }}</strong>
              <span>{{ group.bills.length }} 张账单</span>
            </div>
            <div class="month-summary">
              <div>
                <span>应收合计</span>
                <strong>¥{{ group.totalReceivable }}</strong>
              </div>
              <div>
                <span>实收合计</span>
                <strong>¥{{ group.totalReceived }}</strong>
              </div>
              <div>
                <span>未付</span>
                <strong>{{ group.unpaidCount }} 张</strong>
              </div>
            </div>
          </div>
        </template>
        <van-cell-group>
          <van-cell
            v-for="bill in group.bills"
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
      </van-collapse-item>
    </van-collapse>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue';
import http from '../../utils/http';
import { billStatusMap } from '../../utils/status';
import { usePropertyStore } from '../../stores/property';

const propertyStore = usePropertyStore();
const bills = ref<any[]>([]);
const activeTab = ref('');
const activeMonths = ref<string[]>([]);
const loading = ref(true);

const monthGroups = computed(() => {
  const groups = new Map<string, any[]>();
  bills.value.forEach((bill) => {
    const month = bill.periodStart?.slice(0, 7) || '未知月份';
    const monthBills = groups.get(month) || [];
    monthBills.push(bill);
    groups.set(month, monthBills);
  });

  return Array.from(groups.entries())
    .sort(([monthA], [monthB]) => monthB.localeCompare(monthA))
    .map(([month, monthBills]) => ({
      month,
      bills: monthBills,
      totalReceivable: monthBills
        .reduce((sum, bill) => sum + Number(bill.totalAmount), 0)
        .toFixed(2),
      totalReceived: monthBills
        .filter((bill) => bill.status === 'PAID')
        .reduce((sum, bill) => sum + Number(bill.totalAmount), 0)
        .toFixed(2),
      unpaidCount: monthBills.filter((bill) => bill.status !== 'PAID').length,
    }));
});

function statusLabel(s: string) { return billStatusMap[s] || s; }
function tagType(s: string) {
  if (s === 'PAID') return 'success';
  if (s === 'OVERDUE') return 'danger';
  return 'warning';
}

async function fetchBills() {
  loading.value = true;
  try {
    activeMonths.value = [];
    const params: Record<string, string> = {};
    if (activeTab.value) params.status = activeTab.value;
    if (propertyStore.currentPropertyId) params.propertyId = String(propertyStore.currentPropertyId);
    bills.value = await http.get('/bills', { params }) as any;
  } finally { loading.value = false; }
}

onMounted(fetchBills);

watch(() => propertyStore.currentPropertyId, () => {
  fetchBills();
});
</script>

<style scoped>
.page-loading { display: flex; justify-content: center; padding: 60px; }
.month-list { margin: 12px 16px; }
.month-list :deep(.van-collapse-item) { margin-bottom: 12px; border-radius: 8px; overflow: hidden; }
.month-list :deep(.van-collapse-item::after) { display: none; }
.month-card { width: 100%; }
.month-title { display: flex; align-items: center; justify-content: space-between; }
.month-title span { color: #969799; font-size: 13px; font-weight: normal; }
.month-summary { display: flex; justify-content: space-between; margin-top: 12px; }
.month-summary div { display: flex; flex-direction: column; gap: 4px; }
.month-summary span { color: #969799; font-size: 12px; }
.month-summary strong { color: #323233; font-size: 14px; }
</style>
