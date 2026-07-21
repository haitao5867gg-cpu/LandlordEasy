<template>
  <div>
    <van-nav-bar title="待确认收款" left-arrow @click-left="$router.back()">
      <template #right>
        <van-button size="small" @click="showManual = true">手动记账</van-button>
      </template>
    </van-nav-bar>
    <van-loading v-if="loading" class="page-loading" />
    <van-empty v-else-if="list.length === 0" description="暂无待确认收款" />
    <van-cell-group v-else inset>
      <van-cell v-for="p in list" :key="p.id">
        <template #title>
          <div>{{ p.bill?.lease?.tenant?.name }} - {{ p.bill?.lease?.room?.building?.name }}{{ p.bill?.lease?.room?.roomNo }}</div>
        </template>
        <template #label>
          <div>¥{{ p.amount }} · {{ p.paidAt?.split('T')[0] }}</div>
          <van-image v-if="p.proofUrl" :src="p.proofUrl" width="60" height="60" fit="cover" @click="previewImage(p.proofUrl)" />
        </template>
        <template #value>
          <van-button size="small" type="success" @click="handleConfirm(p.id, 'confirm')">确认</van-button>
          <van-button size="small" type="danger" style="margin-left:8px;" @click="handleConfirm(p.id, 'reject')">驳回</van-button>
        </template>
      </van-cell>
    </van-cell-group>

    <!-- 手动记账弹窗 -->
    <van-dialog v-model:show="showManual" title="手动记账" show-cancel-button @confirm="handleManual">
      <van-field v-model.number="manualForm.billId" label="账单ID" type="number" />
      <van-field name="channel" label="渠道">
        <template #input>
          <van-radio-group v-model="manualForm.channel" direction="horizontal">
            <van-radio name="CASH">现金</van-radio>
            <van-radio name="TRANSFER">转账</van-radio>
          </van-radio-group>
        </template>
      </van-field>
      <van-field v-model.number="manualForm.amount" label="金额" type="number" />
      <van-field v-model="manualForm.paidAt" label="付款日期" placeholder="YYYY-MM-DD" />
    </van-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { showToast, showImagePreview } from 'vant';
import http from '../../utils/http';

const list = ref<any[]>([]);
const loading = ref(true);
const showManual = ref(false);
const manualForm = reactive({ billId: 0, channel: 'CASH', amount: 0, paidAt: '' });

async function fetchList() {
  loading.value = true;
  try { list.value = await http.get('/payments/pending') as any; }
  finally { loading.value = false; }
}

onMounted(fetchList);

async function handleConfirm(id: number, action: string) {
  await http.post(`/payments/${id}/confirm`, { action });
  showToast(action === 'confirm' ? '已确认' : '已驳回');
  await fetchList();
}

async function handleManual() {
  await http.post('/payments/manual', manualForm);
  showToast('记账成功');
  manualForm.billId = 0; manualForm.amount = 0; manualForm.paidAt = '';
  await fetchList();
}

function previewImage(url: string) {
  showImagePreview([url]);
}
</script>

<style scoped>
.page-loading { display: flex; justify-content: center; padding: 60px; }
</style>
