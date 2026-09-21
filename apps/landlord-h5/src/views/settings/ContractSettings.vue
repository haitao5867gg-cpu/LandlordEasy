<template>
  <div>
    <van-nav-bar title="合同签约设置" left-arrow @click-left="$router.back()" />
    <van-form @submit="saveSettings">
      <van-cell-group inset title="甲方信息">
        <van-field
          v-model.trim="form.landlordName"
          name="landlordName"
          label="甲方姓名"
          placeholder="请输入甲方姓名"
          :rules="[{ required: true, message: '请输入甲方姓名' }]"
        />
        <van-field
          v-model.trim="form.landlordIdCard"
          name="landlordIdCard"
          label="甲方身份证号"
          placeholder="请输入15或18位身份证号"
          :rules="[
            { required: true, message: '请输入甲方身份证号' },
            { pattern: idCardPattern, message: '身份证号格式不正确' },
          ]"
        />
        <van-field
          v-model.trim="form.landlordPhone"
          name="landlordPhone"
          label="甲方电话"
          type="tel"
          placeholder="请输入11位手机号"
          :rules="[
            { required: true, message: '请输入甲方电话' },
            { pattern: phonePattern, message: '手机号格式不正确' },
          ]"
        />
      </van-cell-group>

      <van-cell-group inset title="收款与费用">
        <van-field v-model.trim="form.payeeName" label="收款人姓名" placeholder="合同第二条收款人,如占秀英" />
        <van-field v-model="form.waterPrice" label="水费单价(元/吨)" type="number" placeholder="默认8" />
        <van-field v-model="form.electricityPrice" label="电费单价(元/度)" type="number" placeholder="默认1.3" />
        <van-field v-model.trim="form.otherFeeRule" label="网络物业等" placeholder="默认:以实际发生为准" />
      </van-cell-group>

      <van-cell-group inset title="默认合同条款">
        <van-field v-model="form.defaultPenaltyMonths" label="违约金月数" type="number" placeholder="默认1个月" />
        <van-field v-model="form.defaultOverdueDays" label="逾期容忍天数" type="number" placeholder="默认5天" />
        <van-field v-model="form.defaultCleaningFee" label="退房清洁费" type="number" placeholder="默认110元" />
        <van-field v-model="form.defaultRenewNoticeDays" label="续租提前通知" type="number" placeholder="默认30天" />
      </van-cell-group>

      <van-cell-group inset title="合同期限参数">
        <van-field v-model="form.continuousStayDays" label="连续居住天数" type="number" placeholder="超过即视为长期同住人,默认30天" />
        <van-field v-model="form.cumulativeStayDays" label="累计居住天数" type="number" placeholder="超过即视为长期同住人,默认90天" />
        <van-field v-model="form.earlyTerminationNoticeDays" label="提前退租通知" type="number" placeholder="默认30天" />
        <van-field v-model="form.nonRenewalNoticeDays" label="不续租通知" type="number" placeholder="默认30天" />
        <van-field v-model="form.abandonedPropertyDays" label="遗留物保管" type="number" placeholder="默认30天" />
        <van-field v-model="form.depositRefundWorkDays" label="押金退还工作日" type="number" placeholder="默认3个工作日" />
        <van-field v-model="form.electronicNoticeHours" label="电子通知送达" type="number" placeholder="发送后N小时视为送达,默认24" />
        <van-field v-model="form.maxOccupantsPerRoom" label="单间居住人数上限" type="number" placeholder="默认2人" />
        <van-field v-model="form.rentOverdueTerminateDays" label="逾期可解除天数" type="number" placeholder="逾期超N日甲方可解约,默认15" />
        <van-field v-model="form.disguisedSubletDays" label="变相转租认定天数" type="number" placeholder="非同住人连续占用超N日,默认15" />
      </van-cell-group>

      <van-cell-group inset title="默认物品清单">
        <van-field
          v-model="form.defaultItemChecklistText"
          rows="6"
          autosize
          type="textarea"
          placeholder="每行一项,格式:物品名称 数量(数量可省略默认1)。生成电子签约和新增交接记录时自动预填这份清单。&#10;例如:&#10;空调 1&#10;冰箱 1&#10;床及床垫 2"
        />
      </van-cell-group>

      <div class="submit-area">
        <van-button block type="primary" native-type="submit" :loading="saving">
          {{ configured ? '更新配置' : '保存配置' }}
        </van-button>
      </div>
    </van-form>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { showToast } from 'vant';
import http from '../../utils/http';
import { ID_CARD_PATTERN, PHONE_PATTERN } from '../../utils/validators';

const idCardPattern = ID_CARD_PATTERN;
const phonePattern = PHONE_PATTERN;
const configured = ref(false);
const saving = ref(false);
const form = reactive({
  landlordName: '',
  landlordIdCard: '',
  landlordPhone: '',
  payeeName: '',
  otherFeeRule: '',
  defaultPenaltyMonths: '',
  defaultOverdueDays: '',
  defaultCleaningFee: '',
  waterPrice: '',
  electricityPrice: '',
  defaultRenewNoticeDays: '',
  continuousStayDays: '',
  cumulativeStayDays: '',
  earlyTerminationNoticeDays: '',
  nonRenewalNoticeDays: '',
  abandonedPropertyDays: '',
  depositRefundWorkDays: '',
  electronicNoticeHours: '',
  maxOccupantsPerRoom: '',
  rentOverdueTerminateDays: '',
  disguisedSubletDays: '',
  defaultItemChecklistText: '',
});

onMounted(async () => {
  const settings = await http.get('/admin/contract-settings') as any;
  configured.value = Boolean(settings.id);
  if (!configured.value) return;

  form.landlordName = settings.landlordName || '';
  form.landlordIdCard = settings.landlordIdCard || '';
  form.landlordPhone = settings.landlordPhone || '';
  form.payeeName = settings.payeeName || '';
  form.otherFeeRule = settings.otherFeeRule || '';
  form.defaultPenaltyMonths = String(settings.defaultPenaltyMonths ?? '');
  form.defaultOverdueDays = String(settings.defaultOverdueDays ?? '');
  form.defaultCleaningFee = String(settings.defaultCleaningFee ?? '');
  form.waterPrice = settings.waterPrice === null || settings.waterPrice === undefined ? '' : String(settings.waterPrice);
  form.electricityPrice = settings.electricityPrice === null || settings.electricityPrice === undefined ? '' : String(settings.electricityPrice);
  form.defaultRenewNoticeDays = String(settings.defaultRenewNoticeDays ?? '');
  form.continuousStayDays = String(settings.continuousStayDays ?? '');
  form.cumulativeStayDays = String(settings.cumulativeStayDays ?? '');
  form.earlyTerminationNoticeDays = String(settings.earlyTerminationNoticeDays ?? '');
  form.nonRenewalNoticeDays = String(settings.nonRenewalNoticeDays ?? '');
  form.abandonedPropertyDays = String(settings.abandonedPropertyDays ?? '');
  form.depositRefundWorkDays = String(settings.depositRefundWorkDays ?? '');
  form.electronicNoticeHours = String(settings.electronicNoticeHours ?? '');
  form.maxOccupantsPerRoom = String(settings.maxOccupantsPerRoom ?? '');
  form.rentOverdueTerminateDays = String(settings.rentOverdueTerminateDays ?? '');
  form.disguisedSubletDays = String(settings.disguisedSubletDays ?? '');
  const checklist: Array<{ item: string; quantity?: number }> = settings.defaultItemChecklist || [];
  form.defaultItemChecklistText = checklist
    .map((entry) => (entry.quantity === undefined || entry.quantity === null ? entry.item : `${entry.item} ${entry.quantity}`))
    .join('\n');
});

function optionalNumber(value: string): number | undefined {
  return value === '' ? undefined : Number(value);
}

function parseChecklistText(text: string): Array<{ item: string; quantity?: number }> | undefined {
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  if (lines.length === 0) return undefined;
  return lines.map((line) => {
    const matched = line.match(/^(.+?)\s+(\d+)$/);
    if (matched) return { item: matched[1].trim(), quantity: Number(matched[2]) };
    return { item: line, quantity: 1 };
  });
}

async function saveSettings() {
  saving.value = true;
  try {
    const settings = await http.put('/admin/contract-settings', {
      landlordName: form.landlordName,
      landlordIdCard: form.landlordIdCard,
      landlordPhone: form.landlordPhone,
      payeeName: form.payeeName || undefined,
      otherFeeRule: form.otherFeeRule || undefined,
      defaultPenaltyMonths: optionalNumber(form.defaultPenaltyMonths),
      defaultOverdueDays: optionalNumber(form.defaultOverdueDays),
      defaultCleaningFee: optionalNumber(form.defaultCleaningFee),
      waterPrice: optionalNumber(form.waterPrice),
      electricityPrice: optionalNumber(form.electricityPrice),
      defaultRenewNoticeDays: optionalNumber(form.defaultRenewNoticeDays),
      continuousStayDays: optionalNumber(form.continuousStayDays),
      cumulativeStayDays: optionalNumber(form.cumulativeStayDays),
      earlyTerminationNoticeDays: optionalNumber(form.earlyTerminationNoticeDays),
      nonRenewalNoticeDays: optionalNumber(form.nonRenewalNoticeDays),
      abandonedPropertyDays: optionalNumber(form.abandonedPropertyDays),
      depositRefundWorkDays: optionalNumber(form.depositRefundWorkDays),
      electronicNoticeHours: optionalNumber(form.electronicNoticeHours),
      maxOccupantsPerRoom: optionalNumber(form.maxOccupantsPerRoom),
      rentOverdueTerminateDays: optionalNumber(form.rentOverdueTerminateDays),
      disguisedSubletDays: optionalNumber(form.disguisedSubletDays),
      defaultItemChecklist: parseChecklistText(form.defaultItemChecklistText),
    }) as any;
    configured.value = Boolean(settings.id);
    showToast('合同签约配置已保存');
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.submit-area { padding: 20px 16px; }
</style>
