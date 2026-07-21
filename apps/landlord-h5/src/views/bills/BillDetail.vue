<template>
  <div>
    <van-nav-bar title="账单详情" left-arrow @click-left="$router.back()" />
    <van-loading v-if="loading" class="page-loading" />
    <template v-else-if="bill">
      <van-cell-group inset title="账单信息">
        <van-cell title="房间" :value="`${bill.lease?.room?.building?.name} ${bill.lease?.room?.roomNo}`" />
        <van-cell title="租客" :value="bill.lease?.tenant?.name" />
        <van-cell title="账期" :value="`${d(bill.periodStart)} ~ ${d(bill.periodEnd)}`" />
        <van-cell title="应付日" :value="d(bill.dueDate)" />
        <van-cell title="总金额" :value="`¥${bill.totalAmount}`" />
        <van-cell title="状态">
          <template #value>
            <van-tag :type="tagType(bill.status)">{{ statusLabel(bill.status) }}</van-tag>
          </template>
        </van-cell>
      </van-cell-group>

      <van-cell-group inset title="费用明细">
        <van-cell v-for="item in bill.items" :key="item.id" :title="item.name" :value="`¥${item.amount}`" :label="itemTypeLabel(item.type)" />
      </van-cell-group>

      <van-cell-group inset title="支付记录">
        <van-empty v-if="!bill.payments?.length" description="暂无支付" />
        <van-cell v-for="p in bill.payments" :key="p.id" :title="channelLabel(p.channel)" :value="`¥${p.amount}`" :label="`${d(p.paidAt)} ${payStatusLabel(p.status)}`" />
      </van-cell-group>

      <div v-if="bill.status === 'OVERDUE'" style="padding:16px;display:flex;gap:12px;">
        <van-button block @click="showAddItem = true">追加费用项</van-button>
        <van-button type="warning" block @click="handleLateFee">追加滞纳金</van-button>
      </div>
      <div v-else-if="['PENDING','OVERDUE'].includes(bill.status)" style="padding:16px;">
        <van-button block @click="showAddItem = true">追加费用项</van-button>
      </div>
      <div v-if="['PENDING','OVERDUE'].includes(bill.status)" style="padding:0 16px 16px;">
        <van-button block plain type="success" @click="showManualPay = true">手动记账(现金/转账)</van-button>
      </div>
    </template>

    <van-dialog v-model:show="showAddItem" title="追加费用项" show-cancel-button @confirm="handleAddItem">
      <van-field v-model="newItem.name" label="名称" placeholder="费用项名称" />
      <van-field v-model.number="newItem.amount" label="金额" type="number" />
    </van-dialog>

    <van-dialog v-model:show="showManualPay" title="手动记账" show-cancel-button @confirm="handleManualPay">
      <van-field name="channel" label="渠道">
        <template #input>
          <van-radio-group v-model="manualForm.channel" direction="horizontal">
            <van-radio name="CASH">现金</van-radio>
            <van-radio name="TRANSFER">转账</van-radio>
          </van-radio-group>
        </template>
      </van-field>
      <van-field v-model.number="manualForm.amount" label="金额" type="number" :placeholder="`${bill?.totalAmount}`" />
      <van-field v-model="manualForm.paidAt" label="付款日期" placeholder="YYYY-MM-DD" />
    </van-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { showToast } from 'vant';
import http from '../../utils/http';
import { billStatusMap, paymentStatusMap, paymentChannelMap } from '../../utils/status';

const route = useRoute();
const bill = ref<any>(null);
const loading = ref(true);
const showAddItem = ref(false);
const showManualPay = ref(false);
const newItem = reactive({ name: '', amount: 0 });
const manualForm = reactive({ channel: 'CASH', amount: 0, paidAt: new Date().toISOString().slice(0, 10) });

function d(s: string) { return s?.split('T')[0] || ''; }
function statusLabel(s: string) { return billStatusMap[s] || s; }
function payStatusLabel(s: string) { return paymentStatusMap[s] || s; }
function channelLabel(s: string) { return paymentChannelMap[s] || s; }
function itemTypeLabel(t: string) {
  const map: Record<string, string> = { RENT: '租金', FEE: '附加费', LATE_FEE: '滞纳金', OTHER: '其他' };
  return map[t] || t;
}
function tagType(s: string) {
  if (s === 'PAID') return 'success';
  if (s === 'OVERDUE') return 'danger';
  return 'warning';
}

async function fetchBill() {
  bill.value = await http.get(`/bills/${route.params.id}`);
}

onMounted(async () => { try { await fetchBill(); } finally { loading.value = false; } });

async function handleAddItem() {
  await http.post(`/bills/${route.params.id}/items`, { type: 'OTHER', name: newItem.name, amount: newItem.amount });
  showToast('已追加');
  newItem.name = ''; newItem.amount = 0;
  await fetchBill();
}

async function handleLateFee() {
  await http.post(`/bills/${route.params.id}/late-fee`, {});
  showToast('滞纳金已追加');
  await fetchBill();
}

async function handleManualPay() {
  const data = {
    billId: Number(route.params.id),
    channel: manualForm.channel,
    amount: manualForm.amount || Number(bill.value?.totalAmount),
    paidAt: manualForm.paidAt,
  };
  await http.post('/payments/manual', data);
  showToast('记账成功');
  manualForm.amount = 0;
  await fetchBill();
}
</script>

<style scoped>
.page-loading { display: flex; justify-content: center; padding: 60px; }
</style>
