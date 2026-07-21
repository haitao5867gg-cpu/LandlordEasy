<template>
  <div>
    <van-nav-bar title="经营报表" left-arrow @click-left="$router.back()" />
    <van-cell-group inset>
      <van-field v-model="month" label="月份" placeholder="2026-07" @blur="fetchReport" />
    </van-cell-group>
    <van-loading v-if="loading" class="page-loading" />
    <template v-else-if="report">
      <van-cell-group inset title="收入概览">
        <van-cell title="应收" :value="`¥${report.receivable}`" />
        <van-cell title="实收" :value="`¥${report.received}`" />
        <van-cell title="收缴率" :value="`${report.collectionRate}%`" />
        <van-cell title="净收益" :value="`¥${report.netIncome}`" />
      </van-cell-group>
      <van-cell-group inset title="按楼栋">
        <van-cell v-for="(v, k) in report.byBuilding" :key="k" :title="String(k)" :value="`应收¥${v.receivable} / 实收¥${v.received} / ${v.rate}%`" />
      </van-cell-group>
      <van-cell-group inset title="支出">
        <van-cell title="支出合计" :value="`¥${report.expense?.total}`" />
        <van-cell v-for="(v, k) in report.expense?.byCategory" :key="k" :title="String(k)" :value="`¥${v}`" />
      </van-cell-group>
      <van-cell-group inset title="空置">
        <van-cell title="空置率" :value="`${report.vacancy?.vacancyRate}%`" />
        <van-cell title="空置房数" :value="String(report.vacancy?.vacantRooms)" />
        <van-cell title="空置损失估算" :value="`¥${report.vacancy?.estimatedLoss}`" />
      </van-cell-group>
      <van-cell-group inset title="押金" v-if="deposit">
        <van-cell title="累计收取" :value="`¥${deposit.totalReceived}`" />
        <van-cell title="累计退还" :value="`¥${deposit.totalRefunded}`" />
        <van-cell title="累计扣除" :value="`¥${deposit.totalDeducted}`" />
        <van-cell title="当前结余" :value="`¥${deposit.currentBalance}`" />
      </van-cell-group>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import http from '../utils/http';
const month = ref(new Date().toISOString().slice(0, 7));
const report = ref<any>(null);
const deposit = ref<any>(null);
const loading = ref(true);

async function fetchReport() {
  loading.value = true;
  try {
    const [r, d] = await Promise.all([
      http.get('/dashboard/reports/monthly', { params: { month: month.value } }),
      http.get('/dashboard/reports/deposit-summary'),
    ]);
    report.value = r; deposit.value = d;
  } finally { loading.value = false; }
}
onMounted(fetchReport);
</script>
<style scoped>.page-loading { display: flex; justify-content: center; padding: 60px; }</style>
