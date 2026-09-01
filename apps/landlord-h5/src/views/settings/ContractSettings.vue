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

      <van-cell-group inset title="默认合同条款">
        <van-field v-model="form.defaultPenaltyMonths" label="违约金月数" type="number" placeholder="默认1个月" />
        <van-field v-model="form.defaultOverdueDays" label="逾期容忍天数" type="number" placeholder="默认5天" />
        <van-field v-model="form.defaultCleaningFee" label="退房清洁费" type="number" placeholder="默认110元" />
        <van-field v-model="form.defaultRenewNoticeDays" label="续租提前通知" type="number" placeholder="默认30天" />
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

const idCardPattern = /^\d{17}[\dXx]$|^\d{15}$/;
const phonePattern = /^1[3-9]\d{9}$/;
const configured = ref(false);
const saving = ref(false);
const form = reactive({
  landlordName: '',
  landlordIdCard: '',
  landlordPhone: '',
  defaultPenaltyMonths: '',
  defaultOverdueDays: '',
  defaultCleaningFee: '',
  defaultRenewNoticeDays: '',
});

onMounted(async () => {
  const settings = await http.get('/admin/contract-settings') as any;
  configured.value = Boolean(settings.id);
  if (!configured.value) return;

  form.landlordName = settings.landlordName || '';
  form.landlordIdCard = settings.landlordIdCard || '';
  form.landlordPhone = settings.landlordPhone || '';
  form.defaultPenaltyMonths = String(settings.defaultPenaltyMonths ?? '');
  form.defaultOverdueDays = String(settings.defaultOverdueDays ?? '');
  form.defaultCleaningFee = String(settings.defaultCleaningFee ?? '');
  form.defaultRenewNoticeDays = String(settings.defaultRenewNoticeDays ?? '');
});

function optionalNumber(value: string): number | undefined {
  return value === '' ? undefined : Number(value);
}

async function saveSettings() {
  saving.value = true;
  try {
    const settings = await http.put('/admin/contract-settings', {
      landlordName: form.landlordName,
      landlordIdCard: form.landlordIdCard,
      landlordPhone: form.landlordPhone,
      defaultPenaltyMonths: optionalNumber(form.defaultPenaltyMonths),
      defaultOverdueDays: optionalNumber(form.defaultOverdueDays),
      defaultCleaningFee: optionalNumber(form.defaultCleaningFee),
      defaultRenewNoticeDays: optionalNumber(form.defaultRenewNoticeDays),
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
