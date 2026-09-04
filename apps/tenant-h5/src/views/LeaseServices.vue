<template>
  <div>
    <van-nav-bar title="在线服务" left-arrow @click-left="$router.back()" />
    <van-loading v-if="loading" class="page-loading" />
    <template v-else-if="lease">
      <van-cell-group inset>
        <van-cell :title="`${lease.room?.building?.name}${lease.room?.roomNo}`" :label="`${lease.startDate?.split('T')[0]} ~ ${lease.endDate?.split('T')[0]}`" />
      </van-cell-group>

      <!-- 在线报修 -->
      <van-cell-group inset title="在线报修" style="margin-top:12px">
        <template v-if="pendingRepair">
          <van-cell title="最近一条报修" :label="pendingRepair.description">
            <template #value><van-tag :type="repairStatusType(pendingRepair.status)">{{ repairStatusText(pendingRepair.status) }}</van-tag></template>
          </van-cell>
        </template>
        <van-field v-model="repairDescription" type="textarea" rows="2" autosize placeholder="描述一下房间里遇到的问题,比如空调不制冷" />
        <van-button size="small" type="primary" style="margin:8px 16px" :loading="submittingRepair" @click="submitRepair">提交报修</van-button>
      </van-cell-group>

      <!-- 申请退租 -->
      <van-cell-group inset title="申请退租" style="margin-top:12px">
        <template v-if="pendingTermination">
          <van-cell title="退租申请状态" :label="`期望搬离:${pendingTermination.requestedMoveOutDate?.split('T')[0]} · 违约金¥${pendingTermination.finalPenalty ?? pendingTermination.suggestedPenalty}`">
            <template #value><van-tag :type="requestStatusType(pendingTermination.status)">{{ requestStatusText(pendingTermination.status) }}</van-tag></template>
          </van-cell>
        </template>
        <template v-else>
          <van-field v-model="terminationForm.date" label="期望搬离日" placeholder="YYYY-MM-DD" @blur="fetchPenaltyPreview" />
          <van-field v-model="terminationForm.reason" label="原因" placeholder="可选" />
          <van-notice-bar v-if="penaltyPreview !== null" left-icon="info-o" :text="`按当前合同条款,预计违约金约¥${penaltyPreview},最终以房东审批为准`" />
          <van-button size="small" type="danger" plain style="margin:8px 16px" :loading="submittingTermination" @click="submitTermination">提交退租申请</van-button>
        </template>
      </van-cell-group>

      <!-- 申请换租 -->
      <van-cell-group inset title="申请换租" style="margin-top:12px">
        <template v-if="pendingTransfer">
          <van-cell title="换租申请状态" :label="pendingTransfer.preferredRoom ? `期望房间:${pendingTransfer.preferredRoom}` : '未填写期望房间'">
            <template #value><van-tag :type="requestStatusType(pendingTransfer.status)">{{ requestStatusText(pendingTransfer.status) }}</van-tag></template>
          </van-cell>
        </template>
        <template v-else>
          <van-field v-model="transferForm.preferredRoom" label="期望房间" placeholder="可选,例如:想换到低楼层" />
          <van-field v-model="transferForm.reason" label="原因" placeholder="可选" />
          <van-button size="small" type="primary" plain style="margin:8px 16px" :loading="submittingTransfer" @click="submitTransfer">提交换租申请</van-button>
        </template>
      </van-cell-group>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { showToast, showConfirmDialog } from 'vant';
import http from '../utils/http';

const route = useRoute();
const leaseId = Number(route.params.id);

const loading = ref(true);
const lease = ref<any>(null);

const repairDescription = ref('');
const submittingRepair = ref(false);
const pendingRepair = ref<any>(null);

const terminationForm = ref({ date: '', reason: '' });
const submittingTermination = ref(false);
const pendingTermination = ref<any>(null);
const penaltyPreview = ref<number | null>(null);

const transferForm = ref({ preferredRoom: '', reason: '' });
const submittingTransfer = ref(false);
const pendingTransfer = ref<any>(null);

function repairStatusText(s: string) {
  return ({ SUBMITTED: '待处理', IN_PROGRESS: '处理中', RESOLVED: '已完成' } as Record<string, string>)[s] || s;
}
function repairStatusType(s: string): 'danger' | 'warning' | 'success' | 'default' {
  return ({ SUBMITTED: 'danger', IN_PROGRESS: 'warning', RESOLVED: 'success' } as Record<string, 'danger' | 'warning' | 'success'>)[s] || 'default';
}
function requestStatusText(s: string) {
  return ({ PENDING: '待处理', APPROVED: '已批准', REJECTED: '已驳回' } as Record<string, string>)[s] || s;
}
function requestStatusType(s: string): 'danger' | 'warning' | 'success' | 'default' {
  return ({ PENDING: 'danger', APPROVED: 'success', REJECTED: 'default' } as Record<string, 'danger' | 'success' | 'default'>)[s] || 'default';
}

async function loadAll() {
  loading.value = true;
  try {
    const leases = (await http.get('/tenant/leases')) as any[];
    lease.value = leases.find((l) => l.id === leaseId) || null;

    const [repairs, terminations, transfers] = await Promise.all([
      http.get('/tenant/repair-requests') as Promise<any[]>,
      http.get('/tenant/termination-requests') as Promise<any[]>,
      http.get('/tenant/transfer-requests') as Promise<any[]>,
    ]);
    pendingRepair.value = repairs.filter((r) => r.leaseId === leaseId && r.status !== 'RESOLVED')[0] || null;
    pendingTermination.value = terminations.filter((r) => r.leaseId === leaseId && r.status === 'PENDING')[0] || null;
    pendingTransfer.value = transfers.filter((r) => r.leaseId === leaseId && r.status === 'PENDING')[0] || null;
  } finally {
    loading.value = false;
  }
}

onMounted(loadAll);

async function submitRepair() {
  if (!repairDescription.value.trim()) {
    showToast('请描述遇到的问题');
    return;
  }
  submittingRepair.value = true;
  try {
    await http.post(`/tenant/leases/${leaseId}/repair-requests`, { description: repairDescription.value });
    showToast('已提交,房东会尽快处理');
    repairDescription.value = '';
    loadAll();
  } finally {
    submittingRepair.value = false;
  }
}

async function fetchPenaltyPreview() {
  if (!terminationForm.value.date) return;
  try {
    const res = (await http.get(`/tenant/leases/${leaseId}/termination-penalty-preview`)) as any;
    penaltyPreview.value = res.suggestedPenalty;
  } catch {
    penaltyPreview.value = null;
  }
}

async function submitTermination() {
  if (!terminationForm.value.date) {
    showToast('请填写期望搬离日期');
    return;
  }
  await showConfirmDialog({
    title: '确认提交退租申请',
    message: '提交后需要房东审批确认,审批通过后合同才会真正终止,是否继续?',
  });
  submittingTermination.value = true;
  try {
    await http.post(`/tenant/leases/${leaseId}/termination-requests`, {
      requestedMoveOutDate: terminationForm.value.date,
      reason: terminationForm.value.reason || undefined,
    });
    showToast('已提交,等待房东审批');
    loadAll();
  } finally {
    submittingTermination.value = false;
  }
}

async function submitTransfer() {
  await showConfirmDialog({
    title: '确认提交换租申请',
    message: '提交后需要房东审批,批准后会自动生成新租约的电子签约,是否继续?',
  });
  submittingTransfer.value = true;
  try {
    await http.post(`/tenant/leases/${leaseId}/transfer-requests`, {
      preferredRoom: transferForm.value.preferredRoom || undefined,
      reason: transferForm.value.reason || undefined,
    });
    showToast('已提交,等待房东审批');
    loadAll();
  } finally {
    submittingTransfer.value = false;
  }
}
</script>

<style scoped>
.page-loading { display: flex; justify-content: center; padding: 60px; }
</style>
