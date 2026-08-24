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

      <van-cell-group inset title="交接记录">
        <div v-if="lease.status === 'ACTIVE'" class="handover-actions">
          <van-button size="small" plain type="primary" @click="openHandoverDialog">新增交接记录</van-button>
        </div>
        <van-empty v-if="!handoverRecords.length" description="暂无交接记录" />
        <van-cell v-for="record in handoverRecords" :key="record.id">
          <template #title>
            <div class="handover-title">
              <van-tag :type="record.type === 'CHECKIN' ? 'success' : 'warning'">
                {{ record.type === 'CHECKIN' ? '入住交接' : '退房交接' }}
              </van-tag>
              <span class="handover-time">{{ dt(record.createdAt) }}</span>
            </div>
          </template>
          <template #label>
            <div v-for="(item, index) in record.checklist || []" :key="index">
              {{ item.item }}: {{ item.condition }}
            </div>
            <div v-if="record.remark">备注: {{ record.remark }}</div>
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

    <!-- 新增交接记录弹窗 -->
    <van-dialog v-model:show="showHandoverDialog" title="新增交接记录" show-cancel-button @confirm="handleAddHandover">
      <van-field name="type" label="类型">
        <template #input>
          <van-radio-group v-model="handoverForm.type" direction="horizontal">
            <van-radio name="CHECKIN">入住交接</van-radio>
            <van-radio name="CHECKOUT">退房交接</van-radio>
          </van-radio-group>
        </template>
      </van-field>
      <div v-for="(item, index) in handoverForm.checklist" :key="index" class="checklist-row">
        <van-field v-model="item.item" placeholder="项目" />
        <van-field v-model="item.condition" placeholder="状况" />
        <van-icon name="delete-o" class="checklist-delete" @click="handoverForm.checklist.splice(index, 1)" />
      </div>
      <van-button size="small" plain class="add-checklist-button" @click="handoverForm.checklist.push({ item: '', condition: '' })">
        + 添加检查项
      </van-button>
      <van-field v-model="handoverForm.remark" label="备注" type="textarea" rows="2" autosize placeholder="可选" />
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
const handoverRecords = ref<any[]>([]);
const loading = ref(true);
const showEndDialog = ref(false);
const showRenewDialog = ref(false);
const showHandoverDialog = ref(false);

const endForm = reactive({ endDate: '', depositRefund: 0, depositDeductReason: '', endReason: '' });
const renewForm = reactive({ newEndDate: '', newRent: undefined as number | undefined });
const handoverForm = reactive({
  type: 'CHECKIN',
  checklist: [] as Array<{ item: string; condition: string }>,
  remark: '',
});

function d(s: string) { return s?.split('T')[0] || ''; }
function dt(s: string) { return s ? s.replace('T', ' ').slice(0, 16) : ''; }
function billStatusLabel(s: string) { return billStatusMap[s] || s; }
function billTagType(s: string) {
  if (s === 'PAID') return 'success';
  if (s === 'OVERDUE') return 'danger';
  return 'warning';
}

async function fetchLease() {
  lease.value = await http.get(`/leases/${route.params.id}`);
}

async function fetchHandoverRecords() {
  handoverRecords.value = await http.get(`/handover?leaseId=${route.params.id}`) as any;
}

onMounted(async () => {
  try {
    await Promise.all([fetchLease(), fetchHandoverRecords()]);
  } finally { loading.value = false; }
});

function openHandoverDialog() {
  handoverForm.type = 'CHECKIN';
  handoverForm.checklist = [];
  handoverForm.remark = '';
  showHandoverDialog.value = true;
}

async function handleAddHandover() {
  const checklist = handoverForm.checklist.filter(item => item.item && item.condition);
  await http.post('/handover', {
    leaseId: Number(route.params.id),
    type: handoverForm.type,
    checklist,
    remark: handoverForm.remark,
  });
  showToast('已添加');
  showHandoverDialog.value = false;
  await fetchHandoverRecords();
}

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
  await fetchLease();
}
</script>

<style scoped>
.page-loading { display: flex; justify-content: center; padding: 60px; }
.handover-actions { padding: 8px 16px; }
.handover-title { display: flex; align-items: center; gap: 8px; }
.handover-time { color: #969799; font-size: 12px; }
.checklist-row { display: flex; align-items: center; }
.checklist-row :deep(.van-field) { flex: 1; }
.checklist-delete { flex: none; margin-right: 16px; color: #ee0a24; font-size: 18px; }
.add-checklist-button { margin: 8px 16px; }
</style>
