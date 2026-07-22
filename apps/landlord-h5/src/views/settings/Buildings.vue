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
        :value="`排序: ${b.sort}`"
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
      <van-field v-model.number="form.sort" label="排序" type="number" placeholder="数字越小越靠前" />
    </van-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { showToast, showConfirmDialog } from 'vant';
import http from '../../utils/http';

const list = ref<any[]>([]);
const showDialog = ref(false);
const isEdit = ref(false);
const editId = ref<number | null>(null);
const form = reactive({ name: '', sort: 0 });

async function fetchList() { list.value = await http.get('/buildings') as any; }
onMounted(fetchList);

function openAdd() {
  isEdit.value = false;
  editId.value = null;
  form.name = '';
  form.sort = 0;
  showDialog.value = true;
}

function openEdit(b: any) {
  isEdit.value = true;
  editId.value = b.id;
  form.name = b.name;
  form.sort = b.sort;
  showDialog.value = true;
}

async function handleSubmit() {
  if (isEdit.value && editId.value) {
    await http.put(`/buildings/${editId.value}`, { name: form.name, sort: form.sort });
    showToast('已更新');
  } else {
    await http.post('/buildings', { name: form.name, sort: form.sort });
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
