<template>
  <div>
    <van-nav-bar title="新签租约" left-arrow @click-left="$router.back()" />
    <van-form @submit="handleSubmit">
      <van-cell-group inset title="租客信息">
        <van-field v-model="form.tenantName" label="姓名" placeholder="租客姓名" :rules="[{ required: true }]" />
        <van-field v-model="form.tenantPhone" label="手机号" placeholder="手机号" :rules="[{ required: true }]" />
        <van-field v-model="form.tenantIdCard" label="身份证" placeholder="可选" />
      </van-cell-group>
      <van-cell-group inset title="租约信息">
        <van-field v-model="form.startDate" label="起租日" placeholder="YYYY-MM-DD" :rules="[{ required: true }]" />
        <van-field v-model="form.endDate" label="到期日" placeholder="YYYY-MM-DD" :rules="[{ required: true }]" />
        <van-field v-model="form.rent" label="月租金" type="number" :rules="[{ required: true }]" />
        <van-field v-model="form.deposit" label="押金" type="number" :rules="[{ required: true }]" />
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
const form = reactive({
  roomId: Number(route.query.roomId) || 0,
  tenantName: '', tenantPhone: '', tenantIdCard: '',
  startDate: '', endDate: '',
  rent: '', deposit: '',
  payCycle: 'MONTHLY', carPlate: '', commission: '',
  feeItems: [] as { name: string; amount: number }[],
});

async function handleSubmit() {
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
