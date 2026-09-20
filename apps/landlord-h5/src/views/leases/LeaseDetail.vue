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
          <div v-else-if="currentSigningTask.status === 'LAUNCHING'" class="contract-status-content">
            <p>签约服务的返回结果不确定,系统已暂停自动重试,避免重复发起。</p>
            <p class="contract-hint">
              请先在微签后台按合同编号 LE-{{ currentSigningTask.id }} 核对。若已存在签约任务,请勿再次发起；若确认不存在,请联系系统维护人员恢复。
            </p>
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
            <div v-if="signQrcode" class="contract-status-content">
              <p class="contract-hint">或把下方「直接签署二维码」截图/长按保存后转发给租客,微信扫码打开即可签署,无需关注公众号:</p>
              <van-image :src="signQrcode.qrcodeImage" width="220" height="220" fit="contain" />
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

      <van-cell-group inset title="共同居住人">
        <div v-if="lease.status === 'ACTIVE'" class="handover-actions">
          <van-button size="small" plain type="primary" @click="openCoOccupantDialog()">新增同住人</van-button>
        </div>
        <van-empty v-if="!(lease.coOccupants && lease.coOccupants.length)" description="无共同居住人" />
        <van-cell v-for="co in lease.coOccupants" :key="co.id">
          <template #title>
            {{ co.name }}
            <van-tag plain type="primary" style="margin-left:6px;">{{ co.idCard }}</van-tag>
          </template>
          <template #label>{{ co.phone }}（备案信息,用于合同附件二）</template>
          <template #right-icon>
            <van-icon name="edit" style="margin-right:10px;" @click="openCoOccupantDialog(co)" />
            <van-icon name="delete-o" class="checklist-delete" @click="handleRemoveCoOccupant(co)" />
          </template>
        </van-cell>
      </van-cell-group>

      <van-cell-group inset title="交接记录">
        <div v-if="lease.status === 'ACTIVE'" class="handover-actions">
          <van-button size="small" plain type="primary" @click="openHandoverDialog()">新增交接记录</van-button>
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
          <template #right-icon>
            <van-icon name="edit" style="margin-right:10px;" @click="openHandoverDialog(record)" />
            <van-icon name="delete-o" class="checklist-delete" @click="handleDeleteHandover(record)" />
          </template>
          <template #label>
            <div v-for="(item, index) in record.checklist || []" :key="index">
              {{ item.item }}<template v-if="item.quantity !== undefined && item.quantity !== null && item.quantity !== ''"> ×{{ item.quantity }}</template>: {{ item.condition }}
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
        <van-cell-group title="水电说明">
          <div class="contract-hint" style="padding:8px 16px;">
            公寓水电为即充即用、入住自动清零,无需填写表底数;合同附件五将自动写入住客信息栏配置的水电单价。
          </div>
        </van-cell-group>
        <van-cell-group title="物品清单(自动取自交接单)">
          <div class="contract-hint" style="padding:8px 16px;">
            合同附件三的物品清单、数量与交付日期将自动取自该租约的「入住交接记录」,无需在此重复填写;如尚未填写,请先完成入住交接。
          </div>
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

    <!-- 同住人新增/编辑弹窗 -->
    <van-dialog v-model:show="showCoOccupantDialog" :title="editingCoOccupantId ? '编辑同住人' : '新增同住人'" show-cancel-button :before-close="beforeCloseCoOccupant">
      <van-field v-model.trim="coOccupantForm.name" label="姓名" placeholder="同住人姓名" :rules="[{ required: true, message: '请填写姓名' }]" />
      <van-field v-model.trim="coOccupantForm.idCard" label="身份证号" maxlength="18" placeholder="15或18位身份证号" :rules="[{ required: true, message: '请填写完整身份证号' }, { pattern: /^\d{17}[\dXx]$|^\d{15}$/, message: '身份证号格式不正确' }]" />
      <van-field v-model.trim="coOccupantForm.phone" label="手机号" type="tel" maxlength="11" placeholder="11位手机号" :rules="[{ required: true, message: '请填写手机号' }, { pattern: /^1[3-9]\d{9}$/, message: '手机号格式不正确' }]" />
    </van-dialog>

    <!-- 新增/编辑交接记录弹窗 -->
    <van-dialog v-model:show="showHandoverDialog" :title="editingHandoverId ? '编辑交接记录' : '新增交接记录'" show-cancel-button :before-close="beforeCloseHandover">
      <van-field name="type" label="类型">
        <template #input>
          <van-radio-group v-model="handoverForm.type" direction="horizontal" :disabled="!!editingHandoverId">
            <van-radio name="CHECKIN">入住交接</van-radio>
            <van-radio name="CHECKOUT">退房交接</van-radio>
          </van-radio-group>
        </template>
      </van-field>
      <div v-for="(item, index) in handoverForm.checklist" :key="index" class="checklist-row">
        <van-field v-model="item.item" placeholder="项目" />
        <van-field v-model="item.quantity" placeholder="数量" type="number" style="flex:0 0 64px;" />
        <van-field v-model="item.condition" placeholder="状况" />
        <van-icon name="delete-o" class="checklist-delete" @click="handoverForm.checklist.splice(index, 1)" />
      </div>
      <div style="display:flex;gap:8px;padding:0 16px 8px;">
        <van-button size="small" plain @click="handoverForm.checklist.push({ item: '', quantity: '', condition: '' })">+ 添加检查项</van-button>
        <van-button size="small" plain type="primary" :loading="prefilling" @click="prefillDefaultChecklist">预填默认物品清单</van-button>
      </div>
      <van-field v-model="handoverForm.remark" label="备注" type="textarea" rows="2" autosize placeholder="可选" />
    </van-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
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
const editingHandoverId = ref<number | null>(null);
const showContractDialog = ref(false);
const generating = ref(false);
const launching = ref(false);
const previewing = ref(false);
const downloading = ref(false);
const confirming = ref(false);
const bindQrcodeImage = ref('');
const bindQrcodeLoading = ref(false);

const showCoOccupantDialog = ref(false);
const editingCoOccupantId = ref<number | null>(null);
const prefilling = ref(false);
const coOccupantForm = reactive({ name: '', idCard: '', phone: '' });

const endForm = reactive({ endDate: '', depositRefund: 0, depositDeductReason: '', endReason: '' });
const renewForm = reactive({ newEndDate: '', newRent: undefined as number | undefined });
const handoverForm = reactive({
  type: 'CHECKIN',
  checklist: [] as Array<{ item: string; quantity: string; condition: string }>,
  remark: '',
});
const contractForm = reactive({
  extraTerms: '',
  penaltyMonths: '',
  overdueToleranceDays: '',
  cleaningFee: '',
  renewalNoticeDays: '',
});
const currentSigningTask = computed(() => lease.value?.contractSigningTasks?.[0] ?? null);
const signQrcode = ref<{ qrcodeImage: string; signUrl: string } | null>(null);
// 任务进入CREATED即拉取"直接签署二维码"(GasCan 2026-09-20要求,扫码直签免关注)
watch(currentSigningTask, async (task) => {
  if (!task || task.status !== 'CREATED') { signQrcode.value = null; return; }
  try {
    signQrcode.value = await http.get(`/leases/contract-signing-tasks/${task.id}/sign-qrcode`) as any;
  } catch {
    signQrcode.value = null;
  }
}, { immediate: true });

function d(s: string) { return s?.split('T')[0] || ''; }
function dt(s: string) {
  const date = new Date(s);
  if (Number.isNaN(date.getTime())) return s || '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
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
    LAUNCHING: '发起结果待核对',
    CREATED: '等待租客签署',
    SIGNED: '已签署',
  }[status] || status;
}
function contractStatusType(status: string): 'primary' | 'success' | 'warning' | 'danger' | 'default' {
  if (status === 'SIGNED') return 'success';
  if (status === 'LAUNCHING') return 'danger';
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
    const payload: Record<string, unknown> = { type: 'NEW' };
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

function openHandoverDialog(record?: { id: number; type: string; checklist?: Array<{ item?: string | null; quantity?: number | null; condition?: string | null }>; remark?: string | null }) {
  editingHandoverId.value = record?.id ?? null;
  handoverForm.type = record?.type ?? 'CHECKIN';
  handoverForm.checklist = record?.checklist?.length
    ? record.checklist.map((entry) => ({
        item: entry.item ?? '',
        quantity: entry.quantity === undefined || entry.quantity === null ? '' : String(entry.quantity),
        condition: entry.condition ?? '',
      }))
    : [];
  handoverForm.remark = record?.remark ?? '';
  showHandoverDialog.value = true;
}

/** 校验交接检查项:全空拦截(不能什么都不填就提交),半填的行指明第几项补全,不再静默丢弃 */
function validateHandoverChecklist(): string | null {
  const rows = handoverForm.checklist;
  const hasAnyRow = rows.some((r) => r.item || r.quantity || r.condition);
  if (!hasAnyRow) return '请至少填写一项检查项(项目和状况必填)';
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.item && !row.quantity && !row.condition) continue;
    if (!row.item || !row.condition) return `第${i + 1}项检查项不完整:项目和状况必填`;
  }
  return null;
}

async function saveHandover(): Promise<boolean> {
  const error = validateHandoverChecklist();
  if (error) {
    showToast(error);
    return false;
  }
  const checklist = handoverForm.checklist
    .filter(item => item.item && item.condition)
    .map(item => ({
      item: item.item,
      quantity: item.quantity === '' ? null : Number(item.quantity),
      condition: item.condition,
    }));
  if (editingHandoverId.value) {
    await http.put(`/handover/${editingHandoverId.value}`, { checklist, remark: handoverForm.remark });
    showToast('已更新');
  } else {
    await http.post('/handover', {
      leaseId: Number(route.params.id),
      type: handoverForm.type,
      checklist,
      remark: handoverForm.remark,
    });
    showToast('已添加');
  }
  await fetchHandoverRecords();
  return true;
}

/** van-dialog before-close:取消直接关,确认走保存且校验失败/请求失败不关窗 */
async function beforeCloseHandover(action: string): Promise<boolean> {
  if (action !== 'confirm') {
    editingHandoverId.value = null;
    return true;
  }
  try {
    const saved = await saveHandover();
    if (!saved) return false;
    editingHandoverId.value = null;
    return true;
  } catch {
    return false; // http拦截器已toast,失败留在弹窗里可改可重试
  }
}

async function handleDeleteHandover(record: { id: number }) {
  await showConfirmDialog({ title: '删除交接记录', message: '删除后不可恢复,确定删除这条交接记录吗?' });
  await http.delete(`/handover/${record.id}`);
  showToast('已删除');
  await fetchHandoverRecords();
}

/** 从合同签约设置拉默认物品清单预填检查项,房东只需改数量/状况 */
async function prefillDefaultChecklist() {
  prefilling.value = true;
  try {
    const settings = await http.get('/admin/contract-settings') as any;
    const checklist: Array<{ item: string; quantity?: number }> =
      settings.defaultItemChecklist && settings.defaultItemChecklist.length
        ? settings.defaultItemChecklist
        : [];
    if (!checklist.length) {
      showToast('尚未在系统设置-合同签约设置里配置默认物品清单');
      return;
    }
    handoverForm.checklist = checklist.map((entry) => ({
      item: entry.item,
      quantity: entry.quantity === undefined || entry.quantity === null ? '' : String(entry.quantity),
      // 默认"完好"而不是留空:提交过滤条件要求 condition 非空,留空会被整行静默丢弃(评审P2#5)
      condition: '完好',
    }));
  } finally {
    prefilling.value = false;
  }
}

function openCoOccupantDialog(co?: { id: number; name: string; idCard?: string | null; phone?: string | null }) {
  editingCoOccupantId.value = co ? co.id : null;
  coOccupantForm.name = co?.name ?? '';
  coOccupantForm.idCard = co?.idCard ?? '';
  coOccupantForm.phone = co?.phone ?? '';
  showCoOccupantDialog.value = true;
}

async function handleSaveCoOccupant(): Promise<boolean> {
  const idCardOk = /^\d{17}[\dXx]$|^\d{15}$/.test(coOccupantForm.idCard);
  const phoneOk = /^1[3-9]\d{9}$/.test(coOccupantForm.phone);
  if (!coOccupantForm.name || !idCardOk || !phoneOk) {
    showToast('请填写姓名、完整身份证号和手机号');
    return false; // 校验不过不关窗,避免用户重新打开重填
  }
  const body: Record<string, unknown> = {
    name: coOccupantForm.name,
    idCard: coOccupantForm.idCard,
    phone: coOccupantForm.phone,
  };
  if (editingCoOccupantId.value) {
    await http.put(`/leases/co-occupants/${editingCoOccupantId.value}`, body);
  } else {
    await http.post(`/leases/${route.params.id}/co-occupants`, body);
  }
  showToast('已保存');
  await fetchLease();
  return true;
}

/** van-dialog before-close:取消直接关,确认走保存且校验失败/请求失败不关窗 */
async function beforeCloseCoOccupant(action: string): Promise<boolean> {
  if (action !== 'confirm') return true;
  try {
    return await handleSaveCoOccupant();
  } catch {
    return false; // http拦截器已toast,失败留在弹窗里可改可重试
  }
}

async function handleRemoveCoOccupant(co: { id: number; name: string }) {
  await showConfirmDialog({ title: '删除同住人', message: `确定删除「${co.name}」吗?` });
  await http.delete(`/leases/co-occupants/${co.id}`);
  showToast('已删除');
  await fetchLease();
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
