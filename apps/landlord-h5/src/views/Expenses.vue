<template>
  <div>
    <van-nav-bar title="支出管理" left-arrow @click-left="$router.back()">
      <template #right><van-icon name="plus" size="20" @click="openAdd" /></template>
    </van-nav-bar>
    <van-loading v-if="loading" class="page-loading" />
    <van-empty v-else-if="list.length === 0" description="暂无支出" />
    <van-cell-group v-else inset>
      <van-cell
        v-for="e in list"
        :key="e.id"
        :title="e.name"
        :label="`${e.category} · ${e.date?.split('T')[0]}`"
        :value="`¥${e.amount}`"
        is-link
        @click="openEdit(e)"
      >
        <template #right-icon>
          <van-icon name="delete-o" class="delete-icon" @click.stop="handleDelete(e)" />
        </template>
      </van-cell>
    </van-cell-group>

    <!-- 新增/编辑弹窗 -->
    <van-dialog v-model:show="showDialog" :title="isEdit ? '编辑支出' : '新增支出'" show-cancel-button @confirm="handleSubmit">
      <van-field v-model="form.date" label="日期" placeholder="YYYY-MM-DD" />
      <van-field v-model="form.category" label="类目" placeholder="如:网费/工资" />
      <van-field v-model="form.name" label="名称" />
      <van-field v-model.number="form.amount" label="金额" type="number" />
      <van-field v-model="form.remark" label="备注" placeholder="可选" />
    </van-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, watch } from 'vue';
import { showToast, showConfirmDialog } from 'vant';
import http from '../utils/http';
import { usePropertyStore } from '../stores/property';

const propertyStore = usePropertyStore();
const list = ref<any[]>([]);
const loading = ref(true);
const showDialog = ref(false);
const isEdit = ref(false);
const editId = ref<number | null>(null);
const form = reactive({ date: '', category: '', name: '', amount: 0, remark: '' });

async function fetchList() {
  const params: Record<string, string> = {};
  if (propertyStore.currentPropertyId) params.propertyId = String(propertyStore.currentPropertyId);
  list.value = await http.get('/expenses', { params }) as any;
}
onMounted(async () => { try { await fetchList(); } finally { loading.value = false; } });

watch(() => propertyStore.currentPropertyId, () => {
  fetchList();
});

function openAdd() {
  isEdit.value = false;
  editId.value = null;
  form.date = '';
  form.category = '';
  form.name = '';
  form.amount = 0;
  form.remark = '';
  showDialog.value = true;
}

function openEdit(expense: any) {
  isEdit.value = true;
  editId.value = expense.id;
  form.date = expense.date?.split('T')[0] || '';
  form.category = expense.category;
  form.name = expense.name;
  form.amount = Number(expense.amount);
  form.remark = expense.remark || '';
  showDialog.value = true;
}

async function handleSubmit() {
  if (isEdit.value && editId.value) {
    await http.put(`/expenses/${editId.value}`, form);
    showToast('已更新');
  } else {
    await http.post('/expenses', form);
    showToast('已添加');
  }
  await fetchList();
}

async function handleDelete(expense: any) {
  try {
    await showConfirmDialog({ title: '确认删除', message: `确定删除「${expense.name}」吗?` });
    await http.delete(`/expenses/${expense.id}`);
    showToast('已删除');
    await fetchList();
  } catch {
    // 取消删除
  }
}
</script>

<style scoped>
.page-loading { display: flex; justify-content: center; padding: 60px; }
.delete-icon { font-size: 18px; color: #ee0a24; margin-left: 8px; }
</style>
