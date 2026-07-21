<template>
  <div class="my-bills-page">
    <van-nav-bar title="我的账单" />
    <van-loading v-if="loading" class="page-loading" />
    <template v-else>
      <!-- 多租约切换 -->
      <van-tabs v-if="leases.length > 1" v-model:active="activeLeaseIdx">
        <van-tab v-for="(l, idx) in leases" :key="l.id" :title="`${l.room?.building?.name}${l.room?.roomNo}`" :name="idx" />
      </van-tabs>

      <template v-if="currentLease">
        <!-- 只读提示 -->
        <van-notice-bar v-if="currentLease.readonly" text="当前无在租房源,以下为历史账单(只读)" left-icon="info-o" />
        <van-notice-bar v-else-if="currentLease.status === 'ENDED'" text="该房源已退租,以下为未结清账单" left-icon="info-o" color="#ed6a0c" background="#fffbe8" />

        <van-empty v-if="!currentLease.bills?.length" description="暂无账单" />
        <van-cell-group v-else inset>
          <van-cell
            v-for="bill in currentLease.bills"
            :key="bill.id"
            :title="`${bill.periodStart?.split('T')[0]} ~ ${bill.periodEnd?.split('T')[0]}`"
            :value="`¥${bill.totalAmount}`"
            :is-link="!currentLease.readonly && ['PENDING','OVERDUE'].includes(bill.status)"
            @click="goPay(bill)"
          >
            <template #label>
              <van-tag :type="tagType(bill.status)">{{ statusLabel(bill.status) }}</van-tag>
            </template>
          </van-cell>
        </van-cell-group>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import http from '../utils/http';

const router = useRouter();
const leases = ref<any[]>([]);
const loading = ref(true);
const activeLeaseIdx = ref(0);

const currentLease = computed(() => leases.value[activeLeaseIdx.value]);

const statusMap: Record<string, string> = { PENDING: '待付', PAID: '已付', OVERDUE: '逾期', CANCELED: '已取消' };
function statusLabel(s: string) { return statusMap[s] || s; }
function tagType(s: string) { if (s === 'PAID') return 'success'; if (s === 'OVERDUE') return 'danger'; return 'warning'; }

function goPay(bill: any) {
  if (currentLease.value?.readonly) return;
  if (['PENDING', 'OVERDUE'].includes(bill.status)) {
    router.push(`/bills/${bill.id}/pay`);
  }
}

onMounted(async () => {
  try { leases.value = await http.get('/tenant/bills') as any; }
  finally { loading.value = false; }
});
</script>

<style scoped>
.my-bills-page { padding-bottom: 20px; }
.page-loading { display: flex; justify-content: center; padding: 60px; }
</style>
