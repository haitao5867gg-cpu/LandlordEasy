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
      </van-cell-group>

      <van-cell-group inset title="租客账号绑定">
        <van-cell title="绑定状态">
          <template #value>
            <van-tag :type="lease.tenant?.openid ? 'success' : 'warning'">
              {{ lease.tenant?.openid ? '已绑定' : '未绑定' }}
            </van-tag>
          </template>
        </van-cell>
        <div v-if="!lease.tenant?.openid" class="bind-status-content">
          <p>转发二维码给租客,微信扫码关注公众号即自动绑定账号</p>
          <van-loading v-if="bindQrcodeLoading" />
          <van-image
            v-else-if="bindQrcodeImage"
            :src="bindQrcodeImage"
            width="180"
            height="180"
            fit="contain"
          />
          <van-button v-else size="small" type="primary" @click="handleGenerateBindQrcode">生成绑定二维码</van-button>
        </div>
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

      <van-cell-group inset title="电子签约">
        <div v-if="!currentSigningTask" class="contract-empty">
          <van-empty description="尚未生成电子签约" />
          <van-button type="primary" size="small" @click="openContractDialog">生成电子签约</van-button>
        </div>
        <template v-else>
          <van-cell title="签约状态">
            <template #value>
              <van-tag :type="contractStatusType(currentSigningTask.status)">
                {{ contractStatusLabel(currentSigningTask.status) }}
              </van-tag>
            </template>
          </van-cell>
          <div v-if="currentSigningTask.status === 'PENDING_SCAN'" class="contract-status-content">
            <p>请转发下方二维码给租客,引导关注公众号</p>
            <van-image
              v-if="currentSigningTask.qrCodeImage"
              :src="currentSigningTask.qrCodeImage"
              width="220"
              height="220"
              fit="contain"
            />
          </div>
          <div v-else-if="currentSigningTask.status === 'FOLLOWED'" class="contract-status-content">
            <p>租客已关注,可以发起签署</p>
            <van-button type="primary" size="small" :loading="launching" @click="handleLaunchSigning">
              发起签署
            </van-button>
          </div>
          <div v-else-if="currentSigningTask.status === 'CREATED'" class="contract-status-content">
            <p>已发起签署,等待租客完成</p>
            <p class="contract-time">发起时间: {{ dt(currentSigningTask.createdAt) }}</p>
            <p class="contract-hint">如果租客已经签署完成但状态没有自动更新(比如中途关闭了浏览器),可以手动核实:</p>
            <div class="contract-manual-actions">
              <van-button plain size="small" :loading="previewing" @click="handlePreviewSignedFile">
                下载查看签署进度
              </van-button>
              <van-button type="success" size="small" :loading="confirming" @click="handleConfirmSigned">
                确认已签署
              </van-button>
            </div>
          </div>
          <div v-else-if="currentSigningTask.status === 'SIGNED'" class="contract-status-content">
            <p>已签署完成</p>
            <p class="contract-time">签署时间: {{ dt(currentSigningTask.signedAt) }}</p>
            <van-button plain type="primary" size="small" :loading="downloading" @click="handleDownloadContract">
              查看/下载合同
            </van-button>
          </div>
        </template>
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

    <!-- 生成电子签约弹窗 -->
    <van-popup v-model:show="showContractDialog" position="bottom" round class="contract-popup">
      <div class="contract-popup-header">生成电子签约</div>
      <van-form @submit="handleGenerateContract">
        <van-cell-group title="水电气表底数">
          <van-field v-model="contractForm.waterMeterReading" label="水表底数" type="number" placeholder="可选" />
          <van-field v-model="contractForm.electricityMeterReading" label="电表底数" type="number" placeholder="可选" />
          <van-field v-model="contractForm.gasMeterReading" label="燃气表底数" type="number" placeholder="可选" />
        </van-cell-group>
        <van-cell-group title="屋内设施">
          <van-checkbox-group v-model="contractForm.facilities" direction="horizontal" class="facility-grid">
            <van-checkbox v-for="facility in facilityOptions" :key="facility" :name="facility">
              {{ facility }}
            </van-checkbox>
          </van-checkbox-group>
        </van-cell-group>
        <van-cell-group title="补充条款">
          <van-field
            v-model="contractForm.extraTerms"
            type="textarea"
            rows="2"
            autosize
            placeholder="可选,请输入补充条款"
          />
        </van-cell-group>
        <van-cell-group title="合同条款覆盖">
          <van-field v-model="contractForm.penaltyMonths" label="违约金月数" type="number" placeholder="留空使用默认值" />
          <van-field v-model="contractForm.overdueToleranceDays" label="逾期容忍天数" type="number" placeholder="留空使用默认值" />
          <van-field v-model="contractForm.cleaningFee" label="清洁费" type="number" placeholder="留空使用默认值" />
          <van-field v-model="contractForm.renewalNoticeDays" label="续租提前通知" type="number" placeholder="留空使用默认值" />
        </van-cell-group>
        <div class="contract-popup-actions">
          <van-button block plain type="default" @click="showContractDialog = false">取消</van-button>
          <van-button block type="primary" native-type="submit" :loading="generating">生成</van-button>
        </div>
      </van-form>
    </van-popup>

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
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast, showConfirmDialog } from 'vant';
import http from '../../utils/http';
import { downloadContract } from '../../utils/contracts';
import { billStatusMap } from '../../utils/status';

const route = useRoute();
const router = useRouter();
const lease = ref<any>(null);
const handoverRecords = ref<any[]>([]);
const loading = ref(true);
const showEndDialog = ref(false);
const showRenewDialog = ref(false);
const showHandoverDialog = ref(false);
const showContractDialog = ref(false);
const generating = ref(false);
const launching = ref(false);
const previewing = ref(false);
const downloading = ref(false);
const confirming = ref(false);
const bindQrcodeImage = ref('');
const bindQrcodeLoading = ref(false);

const facilityOptions = [
  '空调', '冰箱', '洗衣机', '热水器', '燃气灶', '电视',
  '淋浴器', '油烟机', '床', '桌子', '椅子', '沙发',
];

const endForm = reactive({ endDate: '', depositRefund: 0, depositDeductReason: '', endReason: '' });
const renewForm = reactive({ newEndDate: '', newRent: undefined as number | undefined });
const handoverForm = reactive({
  type: 'CHECKIN',
  checklist: [] as Array<{ item: string; condition: string }>,
  remark: '',
});
const contractForm = reactive({
  waterMeterReading: '',
  electricityMeterReading: '',
  gasMeterReading: '',
  facilities: [] as string[],
  extraTerms: '',
  penaltyMonths: '',
  overdueToleranceDays: '',
  cleaningFee: '',
  renewalNoticeDays: '',
});
const currentSigningTask = computed(() => lease.value?.contractSigningTasks?.[0] ?? null);

function d(s: string) { return s?.split('T')[0] || ''; }
function dt(s: string) { return s ? s.replace('T', ' ').slice(0, 16) : ''; }
function billStatusLabel(s: string) { return billStatusMap[s] || s; }
function billTagType(s: string) {
  if (s === 'PAID') return 'success';
  if (s === 'OVERDUE') return 'danger';
  return 'warning';
}
function contractStatusLabel(status: string) {
  return {
    PENDING_SCAN: '待租客关注',
    FOLLOWED: '租客已关注',
    CREATED: '等待租客签署',
    SIGNED: '已签署',
  }[status] || status;
}
function contractStatusType(status: string): 'primary' | 'success' | 'warning' | 'default' {
  if (status === 'SIGNED') return 'success';
  if (status === 'FOLLOWED') return 'primary';
  if (status === 'PENDING_SCAN' || status === 'CREATED') return 'warning';
  return 'default';
}
function optionalNumber(value: string): number | undefined {
  return value === '' ? undefined : Number(value);
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

function openContractDialog() {
  Object.assign(contractForm, {
    waterMeterReading: '',
    electricityMeterReading: '',
    gasMeterReading: '',
    facilities: [],
    extraTerms: '',
    penaltyMonths: '',
    overdueToleranceDays: '',
    cleaningFee: '',
    renewalNoticeDays: '',
  });
  showContractDialog.value = true;
}

function getLaunchOverrides() {
  return {
    penaltyMonths: optionalNumber(contractForm.penaltyMonths),
    overdueToleranceDays: optionalNumber(contractForm.overdueToleranceDays),
    cleaningFee: optionalNumber(contractForm.cleaningFee),
    renewalNoticeDays: optionalNumber(contractForm.renewalNoticeDays),
  };
}

async function handleGenerateContract() {
  generating.value = true;
  try {
    const payload: Record<string, unknown> = {
      type: 'NEW',
      facilities: facilityOptions.map(name => ({
        name,
        has: contractForm.facilities.includes(name),
      })),
    };
    const waterMeterReading = optionalNumber(contractForm.waterMeterReading);
    const electricityMeterReading = optionalNumber(contractForm.electricityMeterReading);
    const gasMeterReading = optionalNumber(contractForm.gasMeterReading);
    if (waterMeterReading !== undefined) payload.waterMeterReading = waterMeterReading;
    if (electricityMeterReading !== undefined) payload.electricityMeterReading = electricityMeterReading;
    if (gasMeterReading !== undefined) payload.gasMeterReading = gasMeterReading;
    if (contractForm.extraTerms.trim()) payload.extraTerms = contractForm.extraTerms.trim();
    const overrides = getLaunchOverrides();
    if (overrides.penaltyMonths !== undefined) payload.penaltyMonths = overrides.penaltyMonths;
    if (overrides.overdueToleranceDays !== undefined) payload.overdueToleranceDays = overrides.overdueToleranceDays;
    if (overrides.cleaningFee !== undefined) payload.cleaningFee = overrides.cleaningFee;
    if (overrides.renewalNoticeDays !== undefined) payload.renewalNoticeDays = overrides.renewalNoticeDays;

    await http.post(`/leases/${route.params.id}/contract-signing-tasks`, payload);
    showContractDialog.value = false;
    showToast('电子签约已生成');
    await fetchLease();
  } finally {
    generating.value = false;
  }
}

async function handleLaunchSigning() {
  const task = currentSigningTask.value;
  if (!task) return;

  launching.value = true;
  try {
    await http.post(`/leases/contract-signing-tasks/${task.id}/launch`, {});
    showToast('已发起签署');
    await fetchLease();
  } finally {
    launching.value = false;
  }
}

async function handlePreviewSignedFile() {
  const task = currentSigningTask.value;
  if (!task || previewing.value) return;
  previewing.value = true;
  try {
    await downloadContract(task.id, true);
  } catch {
    showToast('签署进度下载失败，请稍后重试');
  } finally {
    previewing.value = false;
  }
}

async function handleDownloadContract() {
  const task = currentSigningTask.value;
  if (!task || downloading.value) return;
  downloading.value = true;
  try {
    await downloadContract(task.id);
  } catch {
    showToast('合同下载失败，请稍后重试');
  } finally {
    downloading.value = false;
  }
}

async function handleConfirmSigned() {
  const task = currentSigningTask.value;
  if (!task) return;

  try {
    await showConfirmDialog({
      title: '确认已签署',
      message: '请确认已经打开PDF核实乙方(租客)签字栏确实已签字,再点击确认。仅甲方(发起方)盖章不代表签署完成。',
    });
  } catch {
    return;
  }

  confirming.value = true;
  try {
    await http.post(`/leases/contract-signing-tasks/${task.id}/confirm-signed`, {});
    showToast('已确认签署完成');
    await fetchLease();
  } finally {
    confirming.value = false;
  }
}

async function handleGenerateBindQrcode() {
  bindQrcodeLoading.value = true;
  try {
    const res = (await http.post(
      `/leases/${route.params.id}/bind-qrcode`,
      {},
    )) as { qrCodeImage: string };
    bindQrcodeImage.value = res.qrCodeImage;
  } finally {
    bindQrcodeLoading.value = false;
  }
}

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
.contract-empty { padding: 4px 16px 16px; text-align: center; }
.contract-empty :deep(.van-empty) { padding: 16px 0 8px; }
.contract-status-content { padding: 8px 16px 16px; text-align: center; }
.bind-status-content { padding: 8px 16px 16px; text-align: center; }
.bind-status-content p { margin: 4px 0 12px; color: #969799; font-size: 12px; }
.contract-status-content p { margin: 4px 0 12px; }
.contract-time { color: #969799; font-size: 13px; }
.contract-link { display: inline-block; color: #1989fa; font-size: 14px; }
.contract-hint { color: #969799; font-size: 12px; margin: 0 0 12px; }
.contract-manual-actions { display: flex; justify-content: center; gap: 12px; }
.contract-popup { max-height: 88vh; overflow-y: auto; }
.contract-popup-header { padding: 16px; text-align: center; font-size: 17px; font-weight: 600; }
.facility-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px 8px; padding: 12px 16px 18px; }
.contract-popup-actions { display: flex; gap: 12px; padding: 16px; }
.handover-actions { padding: 8px 16px; }
.handover-title { display: flex; align-items: center; gap: 8px; }
.handover-time { color: #969799; font-size: 12px; }
.checklist-row { display: flex; align-items: center; }
.checklist-row :deep(.van-field) { flex: 1; }
.checklist-delete { flex: none; margin-right: 16px; color: #ee0a24; font-size: 18px; }
.add-checklist-button { margin: 8px 16px; }
</style>
