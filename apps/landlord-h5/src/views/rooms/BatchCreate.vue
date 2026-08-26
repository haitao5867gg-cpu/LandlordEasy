<template>
  <div>
    <van-nav-bar title="批量建房" left-arrow @click-left="$router.back()" />
    <van-form @submit="handleSubmit" @failed="onFailed">
      <van-cell-group inset>
        <van-field
          name="buildingId"
          label="楼栋"
          readonly
          is-link
          :model-value="selectedBuildingText"
          placeholder="请选择楼栋"
          :rules="[{ required: true, message: '请选择楼栋' }]"
          @click="showBuildingPicker = true"
        />
        <van-field
          name="roomTypeId"
          label="房型(可选)"
          readonly
          is-link
          :model-value="selectedRoomTypeText"
          placeholder="请选择房型"
          @click="showRoomTypePicker = true"
        />
        <van-field
          v-model="form.startRoom"
          label="起始房号"
          placeholder="如 301"
          :rules="[{ required: true, message: '请输入起始房号' }]"
        />
        <van-field v-model="form.endRoom" label="结束房号" placeholder="留空则只建1间" />
      </van-cell-group>
      <div style="margin: 16px;">
        <van-button round block type="primary" native-type="submit" :loading="loading">提交</van-button>
      </div>
    </van-form>

    <van-popup v-model:show="showBuildingPicker" position="bottom">
      <van-picker
        :columns="buildingColumns"
        @confirm="onBuildingConfirm"
        @cancel="showBuildingPicker = false"
      />
    </van-popup>
    <van-popup v-model:show="showRoomTypePicker" position="bottom">
      <van-picker
        :columns="roomTypeColumns"
        @confirm="onRoomTypeConfirm"
        @cancel="showRoomTypePicker = false"
      />
    </van-popup>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import http from '../../utils/http';
import { usePropertyStore } from '../../stores/property';

const router = useRouter();
const propertyStore = usePropertyStore();
const buildings = ref<any[]>([]);
const roomTypes = ref<any[]>([]);
const loading = ref(false);
const showBuildingPicker = ref(false);
const showRoomTypePicker = ref(false);
const form = reactive({ buildingId: 0, roomTypeId: 0, startRoom: '', endRoom: '' });

const buildingColumns = computed(() =>
  buildings.value.map((building) => ({ text: building.name, value: building.id })),
);
const roomTypeColumns = computed(() => [
  { text: '不选', value: 0 },
  ...roomTypes.value.map((roomType) => ({ text: roomType.name, value: roomType.id })),
]);
const selectedBuildingText = computed(
  () => buildings.value.find((building) => building.id === form.buildingId)?.name || '',
);
const selectedRoomTypeText = computed(
  () => roomTypeColumns.value.find((roomType) => roomType.value === form.roomTypeId)?.text || '',
);

onMounted(async () => {
  const params: Record<string, string> = {};
  if (propertyStore.currentPropertyId) params.propertyId = String(propertyStore.currentPropertyId);
  buildings.value = await http.get('/buildings', { params }) as any;
  roomTypes.value = await http.get('/room-types') as any;
});

function onBuildingConfirm({ selectedOptions }: any) {
  form.buildingId = selectedOptions[0].value;
  showBuildingPicker.value = false;
}

function onRoomTypeConfirm({ selectedOptions }: any) {
  form.roomTypeId = selectedOptions[0].value;
  showRoomTypePicker.value = false;
}

function onFailed(errorInfo: any) {
  showToast(errorInfo.errors?.[0]?.message || '请检查表单');
}

async function handleSubmit() {
  loading.value = true;
  try {
    const data: any = { buildingId: form.buildingId, startRoom: form.startRoom };
    if (form.endRoom) data.endRoom = form.endRoom;
    if (form.roomTypeId) data.roomTypeId = form.roomTypeId;
    const res = await http.post('/rooms/batch', data) as any;
    if (res.skipped?.length) {
      showToast(`成功创建${res.created}间房，房号${res.skipped.join('、')}已存在未创建`);
    } else {
      showToast(`成功创建 ${res.created} 间房`);
    }
    router.back();
  } finally {
    loading.value = false;
  }
}
</script>
