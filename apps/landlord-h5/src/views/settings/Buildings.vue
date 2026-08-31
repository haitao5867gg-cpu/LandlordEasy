<template>
  <div>
    <van-nav-bar title="楼栋管理" left-arrow @click-left="$router.back()">
      <template #right><van-icon name="plus" size="20" @click="openAdd" /></template>
    </van-nav-bar>
    <van-cell-group inset>
      <van-cell
        v-for="b in list"
        :key="b.id"
        :title="b.name"
        :value="buildingValue(b)"
        is-link
        @click="openEdit(b)"
      >
        <template #right-icon>
          <van-icon name="delete-o" class="delete-icon" @click.stop="handleDelete(b)" />
        </template>
      </van-cell>
    </van-cell-group>

    <!-- 新增/编辑弹窗 -->
    <van-dialog v-model:show="showDialog" :title="isEdit ? '编辑楼栋' : '添加楼栋'" show-cancel-button @confirm="handleSubmit">
      <van-field v-model="form.name" label="名称" placeholder="楼栋名称" />
      <van-field
        label="归属公寓"
        readonly
        is-link
        :model-value="selectedPropertyText"
        placeholder="请选择归属公寓"
        @click="showPropertyPicker = true"
      />
      <van-field v-model.number="form.sort" label="排序" type="number" placeholder="数字越小越靠前" />
    </van-dialog>

    <van-popup v-model:show="showPropertyPicker" position="bottom">
      <van-picker
        :columns="propertyColumns"
        @confirm="onPropertyConfirm"
        @cancel="showPropertyPicker = false"
      />
    </van-popup>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { showToast, showConfirmDialog } from 'vant';
import http from '../../utils/http';
import { usePropertyStore } from '../../stores/property';

const propertyStore = usePropertyStore();
const list = ref<any[]>([]);
const showDialog = ref(false);
const showPropertyPicker = ref(false);
const isEdit = ref(false);
const editId = ref<number | null>(null);
const form = reactive({ name: '', propertyId: 0, sort: 0 });

const propertyColumns = computed(() =>
  propertyStore.properties.map((property) => ({ text: property.name, value: property.id })),
);
const selectedPropertyText = computed(
  () => propertyStore.properties.find((property) => property.id === form.propertyId)?.name || '',
);

async function fetchList() {
  const params: Record<string, string> = {};
  if (propertyStore.currentPropertyId !== null) {
    params.propertyId = String(propertyStore.currentPropertyId);
  }
  list.value = await http.get('/buildings', { params }) as any;
}

onMounted(async () => {
  await propertyStore.fetchProperties();
  await fetchList();
});

watch(() => propertyStore.currentPropertyId, () => {
  fetchList();
});

function buildingValue(b: any) {
  const sortText = `排序: ${b.sort}`;
  if (propertyStore.currentPropertyId !== null) return sortText;
  const propertyName = propertyStore.properties.find((property) => property.id === b.propertyId)?.name || '';
  return `所属公寓: ${propertyName} · ${sortText}`;
}

function openAdd() {
  isEdit.value = false;
  editId.value = null;
  form.name = '';
  form.propertyId = propertyStore.currentPropertyId ?? 0;
  form.sort = 0;
  showDialog.value = true;
}

function openEdit(b: any) {
  isEdit.value = true;
  editId.value = b.id;
  form.name = b.name;
  form.propertyId = b.propertyId;
  form.sort = b.sort;
  showDialog.value = true;
}

function onPropertyConfirm({ selectedOptions }: any) {
  form.propertyId = selectedOptions[0].value;
  showPropertyPicker.value = false;
}

async function handleSubmit() {
  if (!form.propertyId) {
    showToast('请选择归属公寓');
    return;
  }
  const data = { name: form.name, propertyId: form.propertyId, sort: form.sort };
  if (isEdit.value && editId.value) {
    await http.put(`/buildings/${editId.value}`, data);
    showToast('已更新');
  } else {
    await http.post('/buildings', data);
    showToast('已添加');
  }
  await fetchList();
}

async function handleDelete(b: any) {
  try {
    await showConfirmDialog({ title: '确认删除', message: `确定删除「${b.name}」吗？如有房间则无法删除。` });
    await http.delete(`/buildings/${b.id}`);
    showToast('已删除');
    await fetchList();
  } catch {
    // 取消或后端拒绝,拦截器会 toast 错误
  }
}
</script>

<style scoped>
.delete-icon { font-size: 18px; color: #ee0a24; margin-left: 8px; }
</style>
