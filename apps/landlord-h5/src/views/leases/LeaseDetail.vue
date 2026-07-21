<template>
  <div>
    <van-nav-bar title="租约详情" left-arrow @click-left="$router.back()" />
    <van-loading v-if="loading" class="page-loading" />
    <template v-else-if="lease">
      <van-cell-group inset title="租约信息">
        <van-cell title="租客" :value="lease.tenant?.name" />
        <van-cell title="手机" :value="lease.tenant?.phone" />
        <van-cell title="房间" :value="`${lease.room?.building?.name} ${lease.room?.roomNo}`" />
        <van-cell title="租期" :value="`${d(lease.startDate)} ~ ${d(lease.endDate)}`" />
        <van-cell title="月租金" :value="`¥${lease.rent}`" />
        <van-cell title="押金" :value="`¥${lease.deposit}`" />
        <van-cell title="状态">
          <template #value>
            <van-tag :type="lease.status === 'ACTIVE' ? 'success' : 'default'">{{ lease.status === 'ACTIVE' ? '在租' : '已退租' }}</van-tag>
          </template>
        </van-cell>
        <van-cell v-if="lease.inviteCode" title="邀请码" :value="lease.inviteCode" />
      </van-cell-group>

      <van-cell-group inset title="账单">
        <van-empty v-if="!lease.bills?.length" description="暂无账单" />
        <van-cell
          v-for="bill in lease.bills"
          :key="bill.id"
          :title="`${d(bill.periodStart)} ~ ${d(bill.periodEnd)}`"
          :value="`¥${bill.totalAmount}`"
          is-link
          @click="$router.push(`/bills/${bill.id}`)"
        >
          <template #label>
            <van-tag :type="billTagType(bill.status)">{{ billStatusLabel(bill.status) }}</van-tag>
          </template>
        </van-cell>
      </van-cell-group>

      <div v-if="lease.status === 'ACTIVE'" style="padding:16px;display:flex;gap:12px;">
        <van-button type="danger" block @click="showEndDialog = true">退租</van-button>
        <van-button type="primary" block @click="showRenewDialog = true">续签</van-button>
      </div>
    </template>

    <!-- 退租弹窗 -->
    <van-dialog v-model:show="showEndDialog" title="退租" show-cancel-button @confirm="handleEnd">
      <van-field v-model="endForm.endDate" label="退租日" placeholder="YYYY-MM-DD" />
      <van-field v-model.number="endForm.depositRefund" label="退还押金" type="number" />
      <van-field v-model="endForm.depositDeductReason" label="扣款原因" placeholder="可选" />
      <van-field v-model="endForm.endReason" label="退租原因" placeholder="可选" />
    </van-dialog>

    <!-- 续签弹窗 -->
    <van-dialog v-model:show="showRenewDialog" title="续签" show-cancel-button @confirm="handleRenew">
      <van-field v-model="renewForm.newEndDate" label="新到期日" placeholder="YYYY-MM-DD" />
      <van-field v-model.number="renewForm.newRent" label="新租金" type="number" placeholder="不填则不变" />
    </van-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';
import http from '../../utils/http';
import { billStatusMap } from '../../utils/status';

const route = useRoute();
const router = useRouter();
const lease = ref<any>(null);
const loading = ref(true);
const showEndDialog = ref(false);
const showRenewDialog = ref(false);

const endForm = reactive({ endDate: '', depositRefund: 0, depositDeductReason: '', endReason: '' });
const renewForm = reactive({ newEndDate: '', newRent: undefined as number | undefined });

function d(s: string) { return s?.split('T')[0] || ''; }
function billStatusLabel(s: string) { return billStatusMap[s] || s; }
function billTagType(s: string) {
  if (s === 'PAID') return 'success';
  if (s === 'OVERDUE') return 'danger';
  return 'warning';
}

onMounted(async () => {
  try {
    lease.value = await http.get(`/leases/${route.params.id}`);
  } finally { loading.value = false; }
});

async function handleEnd() {
  await http.post(`/leases/${route.params.id}/end`, endForm);
  showToast('退租成功');
  router.back();
}

async function handleRenew() {
  const data: any = { newEndDate: renewForm.newEndDate };
  if (renewForm.newRent) data.newRent = renewForm.newRent;
  await http.post(`/leases/${route.params.id}/renew`, data);
  showToast('续签成功');
  lease.value = await http.get(`/leases/${route.params.id}`);
}
</script>

<style scoped>
.page-loading { display: flex; justify-content: center; padding: 60px; }
</style>
