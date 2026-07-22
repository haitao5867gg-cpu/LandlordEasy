<template>
  <div>
    <van-nav-bar title="新签租约" left-arrow @click-left="$router.back()" />
    <van-form @submit="handleSubmit">
      <van-cell-group inset title="租客信息">
        <van-field v-model="form.tenantName" label="姓名" placeholder="租客姓名" :rules="[{ required: true, message: '请填写姓名' }]" />
        <van-field v-model="form.tenantPhone" label="手机号" placeholder="手机号" :rules="[{ required: true, message: '请填写手机号' }]" />
        <van-field v-model="form.tenantIdCard" label="身份证" placeholder="可选" />
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

        <van-field v-model="form.rent" label="月租金" type="number" :rules="[{ required: true, message: '请填写租金' }]" />
        <van-field v-model="form.deposit" label="押金" type="number" :rules="[{ required: true, message: '请填写押金' }]" />
        <van-field name="payCycle" label="付款周期">
          <template #input>
            <van-radio-group v-model="form.payCycle" direction="horizontal">
              <van-radio name="MONTHLY">月付</van-radio>
              <van-radio name="QUARTERLY">季付</van-radio>
              <van-radio name="YEARLY">年付</van-radio>
            </van-radio-group>
          </template>
        </van-field>
        <van-field v-model="form.carPlate" label="车牌号" placeholder="可选" />
        <van-field v-model="form.commission" label="佣金" type="number" placeholder="可选" />
      </van-cell-group>

      <van-cell-group inset title="附加费用项">
        <div v-for="(item, idx) in form.feeItems" :key="idx" style="display:flex;align-items:center;padding:4px 16px;">
          <van-field v-model="item.name" placeholder="名称" style="flex:1" />
          <van-field v-model.number="item.amount" placeholder="金额" type="number" style="flex:1" />
          <van-icon name="delete-o" @click="form.feeItems.splice(idx,1)" />
        </div>
        <van-button size="small" plain @click="form.feeItems.push({name:'',amount:0})" style="margin:8px 16px">+ 添加费用项</van-button>
      </van-cell-group>

      <div style="margin:16px;">
        <van-button round block type="primary" native-type="submit" :loading="loading">确认签约</van-button>
      </div>
    </van-form>

    <van-dialog v-model:show="showResult" title="签约成功" :showConfirmButton="false">
      <div style="padding:16px;text-align:center;">
        <p>邀请码:</p>
        <h2>{{ inviteCode }}</h2>
        <van-button size="small" @click="copyCode">复制邀请码</van-button>
      </div>
    </van-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { showToast } from 'vant';
import http from '../../utils/http';

const route = useRoute();
const loading = ref(false);
const showResult = ref(false);
const inviteCode = ref('');
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
  feeItems: [] as { name: string; amount: number }[],
});

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
    inviteCode.value = res.inviteCode;
    showResult.value = true;
  } finally {
    loading.value = false;
  }
}

function copyCode() {
  navigator.clipboard.writeText(inviteCode.value);
  showToast('已复制');
}
</script>

<style scoped>
.lease-term { padding: 4px 0; }
</style>
