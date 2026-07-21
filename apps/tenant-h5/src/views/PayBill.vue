<template>
  <div>
    <van-nav-bar title="付款上报" left-arrow @click-left="$router.back()" />
    <van-loading v-if="loading" class="page-loading" />
    <template v-else>
      <!-- 收款码 -->
      <van-cell-group inset title="收款码">
        <van-image v-if="qrcodeUrl" :src="qrcodeUrl" width="200" height="200" style="margin:16px auto;display:block;" />
        <van-empty v-else description="收款码未设置,请联系房东" image="search" />
      </van-cell-group>

      <van-cell-group inset title="账单信息">
        <van-cell title="应付金额" :value="`¥${bill?.totalAmount}`" />
      </van-cell-group>

      <van-form @submit="handleSubmit" v-if="!submitted">
        <van-cell-group inset>
          <van-field v-model.number="form.amount" label="实付金额" type="number" :placeholder="`${bill?.totalAmount}`" />
          <van-field v-model="form.paidAt" label="付款日期" placeholder="YYYY-MM-DD" />
          <van-uploader v-model="fileList" :max-count="1" accept="image/*">
            <van-button size="small" plain style="margin:8px 16px;">上传截图(可选)</van-button>
          </van-uploader>
        </van-cell-group>
        <div style="padding:16px;">
          <van-button block type="primary" native-type="submit" :loading="submitting">我已付款</van-button>
        </div>
      </van-form>

      <van-cell-group v-else inset>
        <van-cell title="已提交" value="待房东确认" />
      </van-cell-group>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { showToast } from 'vant';
import http from '../utils/http';

const route = useRoute();
const bill = ref<any>(null);
const qrcodeUrl = ref('');
const loading = ref(true);
const submitting = ref(false);
const submitted = ref(false);
const fileList = ref<any[]>([]);
const form = reactive({ amount: 0, paidAt: new Date().toISOString().slice(0, 10) });

onMounted(async () => {
  try {
    const [leasesData, qrRes] = await Promise.all([
      http.get('/tenant/bills'),
      http.get('/tenant/qrcode'),
    ]);
    // 从租客账单数据中查找对应 billId
    const billId = Number(route.params.id);
    const allLeases = leasesData as any[];
    for (const lease of allLeases) {
      const found = lease.bills?.find((b: any) => b.id === billId);
      if (found) { bill.value = found; break; }
    }
    qrcodeUrl.value = (qrRes as any).qrcodeImageUrl || '';
    form.amount = Number(bill.value?.totalAmount) || 0;

    // 检查是否已有 PENDING_CONFIRM 的支付记录
    const pendingPayment = bill.value?.payments?.find((p: any) => p.status === 'PENDING_CONFIRM');
    if (pendingPayment) submitted.value = true;
  } finally { loading.value = false; }
});

async function handleSubmit() {
  submitting.value = true;
  try {
    const data: any = {
      billId: Number(route.params.id),
      amount: form.amount || Number(bill.value?.totalAmount),
      paidAt: form.paidAt,
    };
    // TODO: 上传截图获取 URL 后传入 proofUrl
    await http.post('/payments/report', data);
    showToast('已提交,等待房东确认');
    submitted.value = true;
  } finally { submitting.value = false; }
}
</script>

<style scoped>
.page-loading { display: flex; justify-content: center; padding: 60px; }
</style>
