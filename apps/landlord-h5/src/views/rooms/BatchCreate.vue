<template>
  <div>
    <van-nav-bar title="批量建房" left-arrow @click-left="$router.back()" />
    <van-form @submit="handleSubmit">
      <van-cell-group inset>
        <van-field name="buildingId" label="楼栋" :rules="[{ required: true }]">
          <template #input>
            <van-radio-group v-model="form.buildingId" direction="horizontal">
              <van-radio v-for="b in buildings" :key="b.id" :name="b.id">{{ b.name }}</van-radio>
            </van-radio-group>
          </template>
        </van-field>
        <van-field name="roomTypeId" label="房型(可选)">
          <template #input>
            <van-radio-group v-model="form.roomTypeId" direction="horizontal">
              <van-radio :name="0">不选</van-radio>
              <van-radio v-for="rt in roomTypes" :key="rt.id" :name="rt.id">{{ rt.name }}</van-radio>
            </van-radio-group>
          </template>
        </van-field>
        <van-field v-model="form.startRoom" label="起始房号" placeholder="如 301" :rules="[{ required: true }]" />
        <van-field v-model="form.endRoom" label="结束房号" placeholder="如 315" :rules="[{ required: true }]" />
      </van-cell-group>
      <div style="margin: 16px;">
        <van-button round block type="primary" native-type="submit" :loading="loading">提交</van-button>
      </div>
    </van-form>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import http from '../../utils/http';

const router = useRouter();
const buildings = ref<any[]>([]);
const roomTypes = ref<any[]>([]);
const loading = ref(false);
const form = reactive({ buildingId: 0, roomTypeId: 0, startRoom: '', endRoom: '' });

onMounted(async () => {
  buildings.value = await http.get('/buildings') as any;
  roomTypes.value = await http.get('/room-types') as any;
});

async function handleSubmit() {
  loading.value = true;
  try {
    const data: any = { buildingId: form.buildingId, startRoom: form.startRoom, endRoom: form.endRoom };
    if (form.roomTypeId) data.roomTypeId = form.roomTypeId;
    const res = await http.post('/rooms/batch', data) as any;
    showToast(`成功创建 ${res.created} 间房`);
    router.back();
  } finally {
    loading.value = false;
  }
}
</script>
