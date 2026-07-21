<template>
  <div>
    <van-nav-bar title="系统设置" left-arrow @click-left="$router.back()" />
    <van-cell-group inset title="提醒参数">
      <van-field v-model.number="settings.reminderPreDays" label="提前几天提醒" type="number" />
      <van-field v-model.number="settings.reminderOverdueInterval" label="逾期间隔(天)" type="number" />
      <van-button size="small" style="margin:8px 16px" @click="saveSettings">保存</van-button>
    </van-cell-group>
    <van-cell-group inset title="收款码">
      <van-image v-if="settings.qrcodeImageUrl" :src="settings.qrcodeImageUrl" width="150" height="150" />
      <van-uploader :after-read="uploadQrcode" accept="image/*">
        <van-button size="small" style="margin:8px 16px">上传收款码</van-button>
      </van-uploader>
    </van-cell-group>
    <van-cell-group inset title="管理">
      <van-cell title="白名单管理" is-link @click="$router.push('/settings/landlords')" />
      <van-cell title="楼栋管理" is-link @click="$router.push('/settings/buildings')" />
      <van-cell title="房型模板管理" is-link @click="$router.push('/settings/room-types')" />
    </van-cell-group>
  </div>
</template>

<script setup lang="ts">
import { reactive, onMounted } from 'vue';
import { showToast } from 'vant';
import http from '../../utils/http';

const settings = reactive({ reminderPreDays: 3, reminderOverdueInterval: 3, qrcodeImageUrl: '' });

onMounted(async () => {
  const s = await http.get('/admin/settings') as any;
  Object.assign(settings, s);
});

async function saveSettings() {
  await http.put('/admin/settings', { reminderPreDays: settings.reminderPreDays, reminderOverdueInterval: settings.reminderOverdueInterval });
  showToast('已保存');
}

async function uploadQrcode(file: any) {
  const formData = new FormData();
  formData.append('file', file.file);
  const res = await http.post('/admin/qrcode-upload', formData) as any;
  settings.qrcodeImageUrl = res.url;
  showToast('上传成功');
}
</script>
