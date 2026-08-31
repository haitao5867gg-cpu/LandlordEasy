<template>
  <div>
    <van-nav-bar title="公寓管理" left-arrow @click-left="$router.back()">
      <template #right><van-icon name="plus" size="20" @click="openAdd" /></template>
    </van-nav-bar>
    <van-cell-group inset>
      <van-cell
        v-for="p in list"
        :key="p.id"
        :title="p.name"
        :value="`排序: ${p.sort}`"
        is-link
        @click="openEdit(p)"
      >
        <template #right-icon>
          <van-icon name="delete-o" class="delete-icon" @click.stop="handleDelete(p)" />
        </template>
      </van-cell>
    </van-cell-group>

    <van-dialog v-model:show="showDialog" :title="isEdit ? '编辑公寓' : '添加公寓'" show-cancel-button @confirm="handleSubmit">
      <van-field v-model="form.name" label="名称" placeholder="公寓名称" />
      <van-field v-model.number="form.sort" label="排序" type="number" placeholder="数字越小越靠前" />
    </van-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { showToast, showConfirmDialog } from 'vant';
import http from '../../utils/http';
import { usePropertyStore } from '../../stores/property';

const propertyStore = usePropertyStore();
const list = ref<any[]>([]);
const showDialog = ref(false);
const isEdit = ref(false);
const editId = ref<number | null>(null);
const form = reactive({ name: '', sort: 0 });

async function fetchList() { list.value = await http.get('/properties') as any; }
onMounted(fetchList);

function openAdd() {
  isEdit.value = false;
  editId.value = null;
  form.name = '';
  form.sort = 0;
  showDialog.value = true;
}

function openEdit(p: any) {
  isEdit.value = true;
  editId.value = p.id;
  form.name = p.name;
  form.sort = p.sort;
  showDialog.value = true;
}

async function handleSubmit() {
  if (isEdit.value && editId.value) {
    await http.put(`/properties/${editId.value}`, { name: form.name, sort: form.sort });
    showToast('已更新');
  } else {
    await http.post('/properties', { name: form.name, sort: form.sort });
    showToast('已添加');
  }
  await fetchList();
  await propertyStore.fetchProperties();
}

async function handleDelete(p: any) {
  try {
    await showConfirmDialog({ title: '确认删除', message: `确定删除「${p.name}」吗？如有楼栋则无法删除。` });
    await http.delete(`/properties/${p.id}`);
    showToast('已删除');
    await fetchList();
    await propertyStore.fetchProperties();
  } catch {
    // 取消或后端拒绝,拦截器会 toast 错误
  }
}
</script>

<style scoped>
.delete-icon { font-size: 18px; color: #ee0a24; margin-left: 8px; }
</style>
