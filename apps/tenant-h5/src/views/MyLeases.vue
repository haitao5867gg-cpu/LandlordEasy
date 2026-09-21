<template>
  <div>
    <van-nav-bar title="我的租约" left-arrow @click-left="$router.back()" />
    <van-loading v-if="loading" class="page-loading" />
    <van-empty v-else-if="list.length === 0" description="暂无租约" />
    <van-cell-group v-else inset>
      <van-cell
        v-for="l in list"
        :key="l.id"
        :title="`${l.room?.building?.name} ${l.room?.roomNo}`"
        :label="`${l.startDate?.split('T')[0]} ~ ${l.endDate?.split('T')[0]}`"
        :is-link="l.status === 'ACTIVE'"
        @click="l.status === 'ACTIVE' && $router.push(`/leases/${l.id}/services`)"
      >
        <template #value>
          <van-tag :type="l.status === 'ACTIVE' ? 'success' : 'default'">{{ l.status === 'ACTIVE' ? '在租' : '已退租' }}</van-tag>
        </template>
      </van-cell>
    </van-cell-group>
    <van-cell-group inset title="已签署合同（含历史租约）">
      <van-loading v-if="contractsLoading" class="page-loading" />
      <van-cell v-else-if="contractsError" title="合同列表加载失败" is-link value="重试" @click="loadContracts" />
      <van-empty v-else-if="contracts.length === 0" description="暂无已签署合同" />
      <van-cell v-for="contract in contracts" :key="contract.id"
        :title="contractTitle(contract.leaseId)"
        :label="`签署日期：${contract.signedAt?.split('T')[0] || '—'}`">
        <template #value>
          <van-button size="small" plain type="primary" :loading="downloadingIds.includes(contract.id)"
            @click="handleDownload(contract.id)">下载合同</van-button>
        </template>
      </van-cell>
    </van-cell-group>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import http from '../utils/http';
import { downloadContract } from '../utils/contracts';
import { showToast } from 'vant';
const list = ref<any[]>([]);
const loading = ref(true);
type Contract = { id: number; leaseId: number; status: string; signedAt: string | null };
const contracts = ref<Contract[]>([]);
const contractsLoading = ref(true);
const contractsError = ref(false);
const downloadingIds = ref<number[]>([]);
function contractTitle(leaseId: number) {
  const lease = list.value.find((item) => item.id === leaseId);
  return lease ? `${lease.room?.building?.name || ''} ${lease.room?.roomNo || ''} 租赁合同` : `租约 #${leaseId} 合同`;
}
async function loadContracts() {
  contractsLoading.value = true;
  contractsError.value = false;
  try {
    contracts.value = await http.get('/tenant/contracts') as unknown as Contract[];
  } catch {
    contractsError.value = true;
  } finally {
    contractsLoading.value = false;
  }
}
async function handleDownload(id: number) {
  if (downloadingIds.value.includes(id)) return;
  downloadingIds.value.push(id);
  try {
    await downloadContract(id);
  } catch {
    showToast('合同下载失败，请稍后重试');
  } finally {
    downloadingIds.value = downloadingIds.value.filter((value) => value !== id);
  }
}
onMounted(loadContracts);
onMounted(async () => { try { list.value = await http.get('/tenant/leases') as any; } finally { loading.value = false; } });
</script>
<style scoped>.page-loading { display: flex; justify-content: center; padding: 60px; }</style>
