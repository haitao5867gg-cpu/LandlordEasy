<template>
  <div>
    <van-nav-bar title="待处理申请" left-arrow @click-left="$router.back()" />
    <van-tabs v-model:active="activeTab" @change="onTabChange">
      <van-tab title="报修" :badge="repairCount || undefined">
        <van-loading v-if="loadingRepair" class="page-loading" />
        <van-empty v-else-if="repairList.length === 0" description="暂无报修申请" />
        <van-cell-group v-else inset>
          <van-cell
            v-for="r in repairList"
            :key="r.id"
            :title="`${r.room?.building?.name}${r.room?.roomNo} · ${r.tenant?.name}`"
            :label="r.description"
            @click="openRepairDetail(r)"
          >
            <template #value>
              <van-tag :type="repairStatusType(r.status)">{{ repairStatusText(r.status) }}</van-tag>
            </template>
          </van-cell>
        </van-cell-group>
      </van-tab>

      <van-tab title="退租" :badge="terminationCount || undefined">
        <van-loading v-if="loadingTermination" class="page-loading" />
        <van-empty v-else-if="terminationList.length === 0" description="暂无退租申请" />
        <van-cell-group v-else inset>
          <van-cell
            v-for="r in terminationList"
            :key="r.id"
            :title="`${r.lease?.room?.building?.name}${r.lease?.room?.roomNo} · ${r.lease?.tenant?.name}`"
            :label="`期望搬离:${r.requestedMoveOutDate?.split('T')[0]} · 建议违约金¥${r.suggestedPenalty}`"
            @click="openTerminationDetail(r)"
          >
            <template #value>
              <van-tag :type="requestStatusType(r.status)">{{ requestStatusText(r.status) }}</van-tag>
            </template>
          </van-cell>
        </van-cell-group>
      </van-tab>

      <van-tab title="换租" :badge="transferCount || undefined">
        <van-loading v-if="loadingTransfer" class="page-loading" />
        <van-empty v-else-if="transferList.length === 0" description="暂无换租申请" />
        <van-cell-group v-else inset>
          <van-cell
            v-for="r in transferList"
            :key="r.id"
            :title="`${r.lease?.room?.building?.name}${r.lease?.room?.roomNo} · ${r.lease?.tenant?.name}`"
            :label="r.preferredRoom ? `期望房间:${r.preferredRoom}` : (r.reason || '未填写期望房间')"
            @click="openTransferDetail(r)"
          >
            <template #value>
              <van-tag :type="requestStatusType(r.status)">{{ requestStatusText(r.status) }}</van-tag>
            </template>
          </van-cell>
        </van-cell-group>
      </van-tab>
    </van-tabs>

    <!-- 报修详情/处理 -->
    <van-dialog
      v-model:show="showRepairDialog"
      title="报修详情"
      show-cancel-button
      cancel-button-text="关闭"
      :show-confirm-button="false"
    >
      <div class="dialog-body" v-if="currentRepair">
        <p><b>房间:</b>{{ currentRepair.room?.building?.name }}{{ currentRepair.room?.roomNo }}</p>
        <p><b>租客:</b>{{ currentRepair.tenant?.name }}</p>
        <p><b>描述:</b>{{ currentRepair.description }}</p>
        <template v-if="currentRepair.status !== 'RESOLVED'">
          <van-field v-model="repairForm.landlordNote" label="备注" placeholder="可选" />
          <van-field v-model.number="repairForm.resolvedCost" label="维修费用" type="number" placeholder="标记完成时可选填,留空视为0" />
          <div class="dialog-actions">
            <van-button
              v-if="currentRepair.status === 'SUBMITTED'"
              size="small"
              type="primary"
              @click="submitRepairUpdate('IN_PROGRESS')"
            >标记处理中</van-button>
            <van-button size="small" type="success" @click="submitRepairUpdate('RESOLVED')">标记已完成</van-button>
          </div>
        </template>
      </div>
    </van-dialog>

    <!-- 退租审批 -->
    <van-dialog
      v-model:show="showTerminationDialog"
      title="退租申请审批"
      show-cancel-button
      :cancel-button-text="currentTermination?.status === 'PENDING' ? '取消' : '关闭'"
      confirm-button-text="批准退租"
      :show-confirm-button="currentTermination?.status === 'PENDING'"
      :before-close="beforeCloseTermination"
    >
      <div class="dialog-body" v-if="currentTermination">
        <p><b>房间:</b>{{ currentTermination.lease?.room?.building?.name }}{{ currentTermination.lease?.room?.roomNo }}</p>
        <p><b>租客:</b>{{ currentTermination.lease?.tenant?.name }}</p>
        <p><b>期望搬离日:</b>{{ currentTermination.requestedMoveOutDate?.split('T')[0] }}</p>
        <p><b>申请原因:</b>{{ currentTermination.reason || '未填写' }}</p>
        <p><b>押金:</b>¥{{ currentTermination.lease?.deposit }}</p>
        <template v-if="currentTermination.status === 'PENDING'">
          <van-field
            v-model.number="terminationForm.finalPenalty"
            label="确认违约金"
            type="number"
            :placeholder="`建议值¥${currentTermination.suggestedPenalty},可调整`"
          />
          <van-notice-bar
            v-if="terminationForm.finalPenalty !== undefined"
            left-icon="info-o"
            :text="penaltyPreviewText"
            wrapable
          />
          <van-button size="small" plain type="danger" style="margin-top:8px" @click="rejectTermination">驳回申请</van-button>
        </template>
      </div>
    </van-dialog>

    <!-- 换租审批 -->
    <van-dialog
      v-model:show="showTransferDialog"
      title="换租申请审批"
      show-cancel-button
      :cancel-button-text="currentTransfer?.status === 'PENDING' ? '取消' : '关闭'"
      confirm-button-text="批准换租(将发起新合同签约)"
      :show-confirm-button="currentTransfer?.status === 'PENDING'"
      :before-close="beforeCloseTransfer"
    >
      <div class="dialog-body" v-if="currentTransfer">
        <p><b>当前房间:</b>{{ currentTransfer.lease?.room?.building?.name }}{{ currentTransfer.lease?.room?.roomNo }}</p>
        <p><b>租客:</b>{{ currentTransfer.lease?.tenant?.name }}</p>
        <p><b>期望房间:</b>{{ currentTransfer.preferredRoom || '未填写' }}</p>
        <p><b>申请原因:</b>{{ currentTransfer.reason || '未填写' }}</p>
        <template v-if="currentTransfer.status === 'PENDING'">
          <van-field
            readonly
            is-link
            label="目标房间"
            :model-value="selectedTargetRoomText"
            placeholder="请选择空置房间"
            @click="openTargetRoomPicker"
          />
          <van-field v-model.number="transferForm.newRent" label="新租金" type="number" />
          <van-field v-model.number="transferForm.newDeposit" label="新押金" type="number" />
          <van-field v-model="transferForm.newEndDate" label="新到期日" placeholder="YYYY-MM-DD" />
          <van-field v-model.number="transferForm.oldDepositRefund" label="原租约押金结转" type="number" placeholder="默认全额结转到新租约" />
          <van-field
            v-if="!currentTransfer.lease?.tenant?.idCard"
            v-model="transferForm.tenantIdCard"
            label="租客身份证号"
            placeholder="该租客历史记录缺身份证号,需补充"
          />
          <van-button size="small" plain type="danger" style="margin-top:8px" @click="rejectTransfer">驳回申请</van-button>
        </template>
      </div>
    </van-dialog>

    <van-popup v-model:show="showTargetRoomPicker" position="bottom">
      <van-picker :columns="vacantRoomColumns" @confirm="onTargetRoomConfirm" @cancel="showTargetRoomPicker = false" />
    </van-popup>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { showToast, showConfirmDialog } from 'vant';
import http from '../utils/http';

const activeTab = ref(0);

const repairList = ref<any[]>([]);
const terminationList = ref<any[]>([]);
const transferList = ref<any[]>([]);
const loadingRepair = ref(true);
const loadingTermination = ref(true);
const loadingTransfer = ref(true);

const repairCount = computed(() => repairList.value.filter((r) => r.status !== 'RESOLVED').length);
const terminationCount = computed(() => terminationList.value.filter((r) => r.status === 'PENDING').length);
const transferCount = computed(() => transferList.value.filter((r) => r.status === 'PENDING').length);

async function fetchRepair() {
  loadingRepair.value = true;
  try {
    repairList.value = (await http.get('/maintenance/repair-requests')) as any;
  } finally {
    loadingRepair.value = false;
  }
}
async function fetchTermination() {
  loadingTermination.value = true;
  try {
    terminationList.value = (await http.get('/leases/termination-requests')) as any;
  } finally {
    loadingTermination.value = false;
  }
}
async function fetchTransfer() {
  loadingTransfer.value = true;
  try {
    transferList.value = (await http.get('/leases/transfer-requests')) as any;
  } finally {
    loadingTransfer.value = false;
  }
}

function onTabChange() {
  // 三个tab数据一次性全部拉取(数据量小),切换时不用重复请求
}

onMounted(() => {
  fetchRepair();
  fetchTermination();
  fetchTransfer();
});

type TagType = 'danger' | 'warning' | 'success' | 'default';

function repairStatusText(s: string) {
  return ({ SUBMITTED: '待处理', IN_PROGRESS: '处理中', RESOLVED: '已完成' } as Record<string, string>)[s] || s;
}
function repairStatusType(s: string): TagType {
  return ({ SUBMITTED: 'danger', IN_PROGRESS: 'warning', RESOLVED: 'success' } as Record<string, TagType>)[s] || 'default';
}
function requestStatusText(s: string) {
  return ({ PENDING: '待处理', APPROVED: '已批准', REJECTED: '已驳回' } as Record<string, string>)[s] || s;
}
function requestStatusType(s: string): TagType {
  return ({ PENDING: 'danger', APPROVED: 'success', REJECTED: 'default' } as Record<string, TagType>)[s] || 'default';
}

// ---- 报修 ----
const showRepairDialog = ref(false);
const currentRepair = ref<any>(null);
const repairForm = reactive<{ landlordNote: string; resolvedCost?: number }>({ landlordNote: '' });

function openRepairDetail(r: any) {
  currentRepair.value = r;
  repairForm.landlordNote = '';
  repairForm.resolvedCost = undefined;
  showRepairDialog.value = true;
}
async function submitRepairUpdate(status: 'IN_PROGRESS' | 'RESOLVED') {
  await http.post(`/maintenance/repair-requests/${currentRepair.value.id}/status`, {
    status,
    landlordNote: repairForm.landlordNote || undefined,
    resolvedCost: status === 'RESOLVED' ? repairForm.resolvedCost ?? 0 : undefined,
  });
  showToast(status === 'RESOLVED' ? '已标记完成' : '已标记处理中');
  showRepairDialog.value = false;
  fetchRepair();
}

// ---- 退租 ----
const showTerminationDialog = ref(false);
const currentTermination = ref<any>(null);
const terminationForm = reactive<{ finalPenalty?: number }>({});

const penaltyPreviewText = computed(() => {
  if (!currentTermination.value) return '';
  const deposit = Number(currentTermination.value.lease?.deposit || 0);
  const penalty = terminationForm.finalPenalty ?? Number(currentTermination.value.suggestedPenalty);
  const refund = Math.max(0, deposit - penalty);
  const shortfall = Math.max(0, penalty - deposit);
  return shortfall > 0
    ? `押金¥${deposit}全部抵扣违约金,还需向租客追收差额¥${shortfall}(将生成一张待付账单)`
    : `违约金¥${penalty}从押金中抵扣,退还剩余押金¥${refund}`;
});

function openTerminationDetail(r: any) {
  currentTermination.value = r;
  terminationForm.finalPenalty = Number(r.suggestedPenalty);
  showTerminationDialog.value = true;
}
async function beforeCloseTermination(action: string): Promise<boolean> {
  if (action !== 'confirm') return true;
  await http.post(`/leases/termination-requests/${currentTermination.value.id}/approve`, {
    finalPenalty: terminationForm.finalPenalty,
  });
  showToast('已批准退租');
  fetchTermination();
  return true;
}
async function rejectTermination() {
  showTerminationDialog.value = false;
  await showConfirmDialog({ title: '驳回退租申请', message: '确定驳回该租客的退租申请吗?' });
  await http.post(`/leases/termination-requests/${currentTermination.value.id}/reject`, {});
  showToast('已驳回');
  fetchTermination();
}

// ---- 换租 ----
const showTransferDialog = ref(false);
const currentTransfer = ref<any>(null);
const transferForm = reactive<{
  targetRoomId?: number;
  newRent?: number;
  newDeposit?: number;
  newEndDate: string;
  oldDepositRefund?: number;
  tenantIdCard: string;
}>({ newEndDate: '', tenantIdCard: '' });
const showTargetRoomPicker = ref(false);
const vacantRooms = ref<any[]>([]);
const vacantRoomColumns = computed(() =>
  vacantRooms.value.map((r) => ({ text: `${r.building?.name}${r.roomNo}`, value: r.id })),
);
const selectedTargetRoomText = computed(
  () => vacantRooms.value.find((r) => r.id === transferForm.targetRoomId)
    ? `${vacantRooms.value.find((r) => r.id === transferForm.targetRoomId).building?.name}${vacantRooms.value.find((r) => r.id === transferForm.targetRoomId).roomNo}`
    : '',
);

function openTransferDetail(r: any) {
  currentTransfer.value = r;
  transferForm.targetRoomId = undefined;
  transferForm.newRent = Number(r.lease?.rent) || undefined;
  transferForm.newDeposit = Number(r.lease?.deposit) || undefined;
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  transferForm.newEndDate = d.toISOString().split('T')[0];
  transferForm.oldDepositRefund = undefined;
  transferForm.tenantIdCard = '';
  showTransferDialog.value = true;
}
async function openTargetRoomPicker() {
  vacantRooms.value = (await http.get('/rooms', { params: { status: 'VACANT' } })) as any;
  showTargetRoomPicker.value = true;
}
function onTargetRoomConfirm({ selectedOptions }: any) {
  transferForm.targetRoomId = selectedOptions[0].value;
  showTargetRoomPicker.value = false;
}
async function beforeCloseTransfer(action: string): Promise<boolean> {
  if (action !== 'confirm') return true;
  if (!transferForm.targetRoomId) {
    showToast('请先选择目标房间');
    return false;
  }
  await http.post(`/leases/transfer-requests/${currentTransfer.value.id}/approve`, {
    targetRoomId: transferForm.targetRoomId,
    newRent: transferForm.newRent,
    newDeposit: transferForm.newDeposit,
    newEndDate: transferForm.newEndDate,
    oldDepositRefund: transferForm.oldDepositRefund,
    tenantIdCard: transferForm.tenantIdCard || undefined,
  });
  showToast('已批准换租,新合同签约已自动发起');
  fetchTransfer();
  return true;
}
async function rejectTransfer() {
  showTransferDialog.value = false;
  await showConfirmDialog({ title: '驳回换租申请', message: '确定驳回该租客的换租申请吗?' });
  await http.post(`/leases/transfer-requests/${currentTransfer.value.id}/reject`, {});
  showToast('已驳回');
  fetchTransfer();
}
</script>

<style scoped>
.page-loading { display: flex; justify-content: center; padding: 60px; }
.dialog-body { padding: 8px 16px 16px; }
.dialog-body p { margin: 4px 0; font-size: 14px; }
.dialog-actions { display: flex; gap: 8px; margin-top: 12px; }
</style>
