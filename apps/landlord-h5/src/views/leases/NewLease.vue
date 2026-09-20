<template>
  <div>
    <van-nav-bar title="新签租约" left-arrow @click-left="$router.back()" />
    <van-form @submit="handleSubmit">
      <van-cell-group inset title="租客信息">
        <van-field v-model="form.tenantName" label="姓名" placeholder="租客姓名" :rules="[{ required: true, message: '请填写姓名' }]" />
        <van-field
          v-model="form.tenantPhone"
          label="手机号"
          placeholder="手机号"
          :rules="[
            { required: true, message: '请填写手机号' },
            { pattern: PHONE_PATTERN, message: '手机号格式不正确' },
          ]"
        />
        <van-field
          v-model="form.tenantIdCard"
          label="身份证"
          placeholder="身份证号"
          :rules="[
            { required: true, message: '请填写身份证号' },
            { pattern: ID_CARD_PATTERN, message: '身份证号格式不正确' },
          ]"
        />
      </van-cell-group>

      <van-cell-group inset title="租约信息">
        <!-- 起租日: 日期选择器 -->
        <van-field
          v-model="form.startDate"
          label="起租日"
          placeholder="请选择起租日"
          readonly
          is-link
          @click="showStartPicker = true"
          :rules="[{ required: true, message: '请选择起租日' }]"
        />
        <van-popup v-model:show="showStartPicker" position="bottom" round>
          <van-date-picker
            v-model="startPickerValue"
            title="选择起租日"
            :min-date="minDate"
            :max-date="maxDate"
            @confirm="onStartConfirm"
            @cancel="showStartPicker = false"
          />
        </van-popup>

        <!-- 租期选择 -->
        <van-field label="租期" :rules="[{ required: true, message: '请选择租期' }]">
          <template #input>
            <div class="lease-term">
              <van-radio-group v-model="leaseTerm" direction="horizontal" @change="calcEndDate">
                <van-radio name="1m">1个月</van-radio>
                <van-radio name="3m">3个月</van-radio>
                <van-radio name="6m">6个月</van-radio>
                <van-radio name="1y">1年</van-radio>
                <van-radio name="custom">自定义</van-radio>
              </van-radio-group>
              <div v-if="leaseTerm === 'custom'" style="margin-top:8px;display:flex;align-items:center;gap:8px;">
                <van-field v-model.number="customTermValue" type="number" placeholder="数量" style="width:80px;" @blur="calcEndDate" />
                <van-radio-group v-model="customTermUnit" direction="horizontal" @change="calcEndDate">
                  <van-radio name="month">月</van-radio>
                  <van-radio name="year">年</van-radio>
                </van-radio-group>
              </div>
            </div>
          </template>
        </van-field>

        <!-- 到期日(自动算出,只读展示) -->
        <van-cell title="到期日" :value="form.endDate || '选择起租日和租期后自动计算'" />

        <van-field v-model="form.rent" label="月租金" type="number" inputmode="decimal" :rules="[{ required: true, message: '请填写租金' }]">
          <template #button><span class="amount-unit">元</span></template>
        </van-field>
        <van-field v-model="depositModel" label="押金" type="number" inputmode="decimal" :rules="[{ required: true, message: '请填写押金' }]">
          <template #button><span class="amount-unit">元</span></template>
        </van-field>
        <van-field name="payCycle" label="付款周期">
          <template #input>
            <van-radio-group v-model="form.payCycle" direction="horizontal">
              <van-radio name="MONTHLY">月付</van-radio>
              <van-radio name="QUARTERLY">季付</van-radio>
              <van-radio name="YEARLY">年付</van-radio>
            </van-radio-group>
          </template>
        </van-field>
        <van-field
          :model-value="carPlateDisplay"
          label="车牌号"
          placeholder="点击输入车牌号(可选)"
          readonly
          is-link
          @click="openPlateKeyboard"
        />
        <div class="co-occupant-section">
        <div class="co-occupant-header">共同居住人(可选,合同附件二)</div>
        <div v-for="(co, index) in coOccupants" :key="index" class="co-occupant-card">
          <div class="co-occupant-card-title">
            <span>同住人 {{ index + 1 }}</span>
            <van-icon name="delete-o" class="checklist-delete" @click="coOccupants.splice(index, 1)" />
          </div>
          <van-field v-model.trim="co.name" label="姓名" placeholder="同住人姓名" maxlength="20" />
          <van-field v-model.trim="co.idCard" label="身份证号" maxlength="18" placeholder="15或18位身份证号" />
          <van-field v-model.trim="co.phone" label="手机号" type="tel" maxlength="11" placeholder="11位手机号" />
        </div>
        <van-button size="small" plain class="co-add-btn" @click="coOccupants.push({ name: '', idCard: '', phone: '' })">+ 添加同住人</van-button>
      </div>
      <van-field v-model="form.commission" label="佣金" type="number" inputmode="decimal" placeholder="可选">
          <template #button><span class="amount-unit">元</span></template>
        </van-field>
      </van-cell-group>

      <van-cell-group inset title="附加费用项">
        <div v-for="(item, idx) in form.feeItems" :key="idx" style="display:flex;align-items:center;padding:4px 16px;">
          <van-field v-model="item.name" placeholder="名称" style="flex:1" />
          <van-field v-model.number="item.amount" placeholder="金额" type="number" inputmode="decimal" style="flex:1">
            <template #button><span class="amount-unit">元</span></template>
          </van-field>
          <van-icon name="delete-o" @click="form.feeItems.splice(idx,1)" />
        </div>
        <van-button size="small" plain @click="form.feeItems.push({name:'',amount:''})" style="margin:8px 16px">+ 添加费用项</van-button>
      </van-cell-group>

      <div style="margin:16px;">
        <van-button round block type="primary" native-type="submit" :loading="loading">确认签约</van-button>
      </div>
    </van-form>

    <!-- 车牌键盘弹窗 -->
    <van-popup v-model:show="showPlateKeyboard" position="bottom" round>
      <div class="plate-keyboard">
        <div class="plate-slots">
          <div
            v-for="n in PLATE_MAX_LEN"
            :key="n"
            class="plate-slot"
            :class="{ active: n === plateDraft.length + 1, filled: n <= plateDraft.length, hint: n === PLATE_MAX_LEN && plateDraft.length < PLATE_MAX_LEN }"
          >
            <template v-if="n <= plateDraft.length">{{ plateDraft[n - 1] }}</template>
            <template v-else-if="n === PLATE_MAX_LEN">新能源</template>
          </div>
        </div>
        <div class="plate-tools">
          <van-button size="small" plain class="plate-tool-btn" @click="clearPlateDraft">清空</van-button>
          <van-button size="small" plain class="plate-tool-btn" @click="removePlateKey">删除</van-button>
          <van-button size="small" type="primary" class="plate-tool-btn" @click="confirmPlate">确定</van-button>
        </div>
        <div class="plate-keys" :class="platePanel">
          <button
            v-for="ch in (platePanel === 'province' ? PLATE_PROVINCES : platePanel === 'letter' ? PLATE_LETTERS : PLATE_ALNUM)"
            :key="ch"
            type="button"
            class="plate-key"
            @click="pressPlateKey(ch)"
          >{{ ch }}</button>
        </div>
      </div>
    </van-popup>

    <van-dialog v-model:show="showResult" title="签约成功" :showConfirmButton="false">
      <div style="padding:16px;text-align:center;">
        <p>转发下方二维码给租客,微信扫码关注公众号即自动绑定账号</p>
        <van-loading v-if="bindQrcodeLoading" style="margin:24px 0" />
        <van-image
          v-else-if="bindQrcodeImage"
          :src="bindQrcodeImage"
          width="220"
          height="220"
          fit="contain"
          style="margin:8px 0"
        />
        <p v-else class="bind-qrcode-error">二维码生成失败,可以在租约详情页重新生成</p>
      </div>
      <van-button block @click="closeResult">完成</van-button>
    </van-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';
import http from '../../utils/http';
import { ID_CARD_PATTERN, PHONE_PATTERN } from '../../utils/validators';

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const showResult = ref(false);
const coOccupants = ref<Array<{ name: string; idCard: string; phone: string }>>([]);
const bindQrcodeImage = ref('');
const bindQrcodeLoading = ref(false);
const newLeaseId = ref<number | null>(null);
const showStartPicker = ref(false);

const today = new Date();
const minDate = new Date(today.getFullYear() - 1, 0, 1);
const maxDate = new Date(today.getFullYear() + 5, 11, 31);
const startPickerValue = ref([
  String(today.getFullYear()),
  String(today.getMonth() + 1).padStart(2, '0'),
  String(today.getDate()).padStart(2, '0'),
]);

const leaseTerm = ref('1y');
const customTermValue = ref(12);
const customTermUnit = ref('month');

const form = reactive({
  roomId: Number(route.query.roomId) || 0,
  tenantName: '', tenantPhone: '', tenantIdCard: '',
  startDate: formatDate(today),
  endDate: '',
  rent: '', deposit: '',
  payCycle: 'MONTHLY', carPlate: '', commission: '',
  feeItems: [] as { name: string; amount: number | '' }[],
});

// ===== 车牌键盘(主流交互:省份→字母→字母数字,普通车牌7位/新能源8位) =====
const PLATE_PROVINCES = [...'京津冀晋蒙辽吉黑沪苏浙皖闽赣鲁豫鄂湘粤桂琼渝川贵云藏陕甘青宁新'];
const PLATE_LETTERS = [...'ABCDEFGHJKLMNPQRSTUVWXYZ']; // 车牌不用 I/O
const PLATE_ALNUM = [...'0123456789', ...PLATE_LETTERS];
const PLATE_MAX_LEN = 8;
const showPlateKeyboard = ref(false);
const plateDraft = ref('');
const platePanel = computed(() =>
  plateDraft.value.length === 0 ? 'province' : plateDraft.value.length === 1 ? 'letter' : 'alnum',
);
// 展示成 沪A·48563 的可读格式,存储仍是连续字符串
const carPlateDisplay = computed(() =>
  form.carPlate.length > 2 ? `${form.carPlate.slice(0, 2)}·${form.carPlate.slice(2)}` : form.carPlate,
);

function openPlateKeyboard() {
  plateDraft.value = form.carPlate;
  showPlateKeyboard.value = true;
}

function pressPlateKey(ch: string) {
  if (plateDraft.value.length >= PLATE_MAX_LEN) return;
  plateDraft.value += ch;
}

function removePlateKey() {
  plateDraft.value = plateDraft.value.slice(0, -1);
}

function clearPlateDraft() {
  plateDraft.value = '';
}

function confirmPlate() {
  const len = plateDraft.value.length;
  if (len !== 7 && len !== 8) {
    showToast(`车牌号为7位(普通)或8位(新能源),当前${len}位`);
    return;
  }
  form.carPlate = plateDraft.value;
  showPlateKeyboard.value = false;
}

const depositManuallyEdited = ref(false);
const depositModel = computed({
  get: () => form.deposit,
  set: (value: string) => {
    depositManuallyEdited.value = true;
    form.deposit = value;
  },
});

watch(
  () => form.rent,
  (newRent, previousRent) => {
    if (
      !depositManuallyEdited.value
      && (form.deposit === '' || form.deposit === previousRent)
    ) {
      form.deposit = newRent;
    }
  },
);

// 初始化时计算到期日
onMounted(() => { calcEndDate(); });

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function onStartConfirm({ selectedValues }: { selectedValues: string[] }) {
  form.startDate = selectedValues.join('-');
  showStartPicker.value = false;
  calcEndDate();
}

/** 根据起租日+租期计算到期日(处理月末溢出) */
function calcEndDate() {
  if (!form.startDate) return;
  const start = new Date(form.startDate);

  let months = 0;
  switch (leaseTerm.value) {
    case '1m': months = 1; break;
    case '3m': months = 3; break;
    case '6m': months = 6; break;
    case '1y': months = 12; break;
    case 'custom':
      if (customTermUnit.value === 'year') months = (customTermValue.value || 1) * 12;
      else months = customTermValue.value || 1;
      break;
  }

  const end = new Date(start);
  const originalDay = start.getDate();
  end.setMonth(end.getMonth() + months);
  // 月末溢出处理: 如 1/31 + 1月 → 不能是 3/3,应该取 2/28
  if (end.getDate() !== originalDay) {
    end.setDate(0); // 回退到上月最后一天
  }
  // 到期日 = 结束日前一天(比如1年期: 7/23起 → 次年7/22到期)
  end.setDate(end.getDate() - 1);

  form.endDate = formatDate(end);
}

async function handleSubmit() {
  if (!form.endDate) { showToast('请选择租期'); return; }
  loading.value = true;
  try {
    const data: any = {
      roomId: form.roomId,
      tenantName: form.tenantName,
      tenantPhone: form.tenantPhone,
      startDate: form.startDate,
      endDate: form.endDate,
      rent: Number(form.rent),
      deposit: Number(form.deposit),
      payCycle: form.payCycle,
    };
    if (form.tenantIdCard) data.tenantIdCard = form.tenantIdCard;
    if (form.carPlate) data.carPlate = form.carPlate;
    if (form.commission) data.commission = Number(form.commission);
    if (form.feeItems.length) data.feeItems = form.feeItems.filter(i => i.name && i.amount);
    const res = await http.post('/leases', data) as any;
    newLeaseId.value = res.id;
    // 同住人登记(备案信息,失败不阻断租约创建主流程)
    for (const co of coOccupants.value) {
      const idCardOk = ID_CARD_PATTERN.test(co.idCard);
      const phoneOk = PHONE_PATTERN.test(co.phone);
      if (!co.name || !idCardOk || !phoneOk) {
        if (co.name || co.idCard || co.phone) showToast(`同住人「${co.name || '未填姓名'}」信息不完整(姓名/完整身份证号/手机号均必填),已跳过`);
        continue;
      }
      try {
        await http.post(`/leases/${res.id}/co-occupants`, { name: co.name, idCard: co.idCard, phone: co.phone });
      } catch {
        showToast(`同住人「${co.name}」登记失败,可稍后在租约详情页补充`);
      }
    }
    showResult.value = true;
    bindQrcodeLoading.value = true;
    try {
      const qrRes = await http.post(`/leases/${res.id}/bind-qrcode`, {}) as any;
      bindQrcodeImage.value = qrRes.qrCodeImage;
    } catch {
      bindQrcodeImage.value = '';
    } finally {
      bindQrcodeLoading.value = false;
    }
  } finally {
    loading.value = false;
  }
}

function closeResult() {
  showResult.value = false;
  if (newLeaseId.value) {
    router.push(`/leases/${newLeaseId.value}`);
  }
}
</script>

<style scoped>
.lease-term { padding: 4px 0; }
.amount-unit { color: #646566; }
.bind-qrcode-error { color: #ee0a24; font-size: 13px; }
.checklist-delete { color: #969799; padding: 0 8px; font-size: 18px; }
.co-occupant-section { padding: 4px 0; }
.co-occupant-header { font-size: 13px; color: #646566; padding: 6px 16px; }
.co-occupant-card { margin: 0 8px 8px; background: #f7f8fa; border-radius: 8px; overflow: hidden; }
.co-occupant-card-title { display: flex; justify-content: space-between; align-items: center; padding: 8px 8px 0 16px; font-size: 13px; color: #646566; }
.co-add-btn { margin: 0 16px 8px; }

.plate-keyboard { padding: 16px 10px calc(16px + env(safe-area-inset-bottom)); background: #f2f3f5; }
.plate-slots { display: flex; gap: 4px; justify-content: center; margin-bottom: 12px; }
.plate-slot {
  width: 34px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  background: #fff; border: 1px solid #dcdee0; border-radius: 4px;
  font-size: 18px; font-weight: 600; color: #323233;
}
.plate-slot.active { border-color: #1989fa; box-shadow: inset 0 0 0 1px #1989fa; }
.plate-slot.hint { font-size: 9px; font-weight: 400; color: #c8c9cc; }
.plate-tools { display: flex; gap: 8px; justify-content: flex-end; margin-bottom: 10px; }
.plate-tool-btn { min-width: 64px; }
.plate-keys { display: grid; gap: 5px; }
.plate-keys.province { grid-template-columns: repeat(10, 1fr); }
.plate-keys.letter { grid-template-columns: repeat(8, 1fr); }
.plate-keys.alnum { grid-template-columns: repeat(9, 1fr); }
.plate-key {
  height: 38px;
  display: flex; align-items: center; justify-content: center;
  background: #fff; border: none; border-radius: 6px;
  font-size: 15px; color: #323233; padding: 0;
}
.plate-key:active { background: #dde0e6; }
</style>
