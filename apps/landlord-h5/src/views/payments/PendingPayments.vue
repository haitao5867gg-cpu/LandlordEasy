<template>
  <div>
    <van-nav-bar title="待确认收款" left-arrow @click-left="$router.back()" />
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
    <van-notice-bar left-icon="info-o" text="手动记账请从账单详情页操作" style="margin-top:12px;" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { showToast, showImagePreview } from 'vant';
import http from '../../utils/http';

const list = ref<any[]>([]);
const loading = ref(true);

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

function previewImage(url: string) {
  showImagePreview([url]);
}
</script>

<style scoped>
.page-loading { display: flex; justify-content: center; padding: 60px; }
</style>
