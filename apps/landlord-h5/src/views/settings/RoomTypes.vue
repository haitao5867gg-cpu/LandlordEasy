<template>
  <div>
    <van-nav-bar title="房型模板" left-arrow @click-left="$router.back()">
      <template #right><van-icon name="plus" size="20" @click="openAdd" /></template>
    </van-nav-bar>
    <van-cell-group inset>
      <van-cell
        v-for="rt in list"
        :key="rt.id"
        :title="rt.name"
        :label="rt.description"
        is-link
        @click="openEdit(rt)"
      >
        <template #value>¥{{ rt.defaultRent }}/月</template>
        <template #right-icon>
          <van-icon name="delete-o" class="delete-icon" @click.stop="handleDelete(rt)" />
        </template>
      </van-cell>
    </van-cell-group>

    <!-- 新增/编辑弹窗 -->
    <van-dialog v-model:show="showDialog" :title="isEdit ? '编辑房型' : '添加房型'" show-cancel-button @confirm="handleSubmit">
      <van-field v-model="form.name" label="名称" placeholder="如:标准单间" />
      <van-field v-model="form.description" label="描述" placeholder="可选" />
      <van-field v-model.number="form.defaultRent" label="默认租金" type="number" />
      <van-field v-model.number="form.defaultDeposit" label="默认押金" type="number" />
      <van-field name="defaultPayCycle" label="付款周期">
        <template #input>
          <van-radio-group v-model="form.defaultPayCycle" direction="horizontal">
            <van-radio name="MONTHLY">月付</van-radio>
            <van-radio name="QUARTERLY">季付</van-radio>
            <van-radio name="YEARLY">年付</van-radio>
          </van-radio-group>
        </template>
      </van-field>
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
const form = reactive({ name: '', description: '', defaultRent: 0, defaultDeposit: 0, defaultPayCycle: 'MONTHLY' });

async function fetchList() { list.value = await http.get('/room-types') as any; }
onMounted(fetchList);

function openAdd() {
  isEdit.value = false;
  editId.value = null;
  form.name = '';
  form.description = '';
  form.defaultRent = 0;
  form.defaultDeposit = 0;
  form.defaultPayCycle = 'MONTHLY';
  showDialog.value = true;
}

function openEdit(rt: any) {
  isEdit.value = true;
  editId.value = rt.id;
  form.name = rt.name;
  form.description = rt.description || '';
  form.defaultRent = Number(rt.defaultRent);
  form.defaultDeposit = Number(rt.defaultDeposit);
  form.defaultPayCycle = rt.defaultPayCycle || 'MONTHLY';
  showDialog.value = true;
}

async function handleSubmit() {
  if (isEdit.value && editId.value) {
    await http.put(`/room-types/${editId.value}`, form);
    showToast('已更新');
  } else {
    await http.post('/room-types', form);
    showToast('已添加');
  }
  await fetchList();
}

async function handleDelete(rt: any) {
  try {
    await showConfirmDialog({ title: '确认删除', message: `确定删除「${rt.name}」吗？如有房间使用该房型则无法删除。` });
    await http.delete(`/room-types/${rt.id}`);
    showToast('已删除');
    await fetchList();
  } catch {
    // 取消或后端拒绝
  }
}
</script>

<style scoped>
.delete-icon { font-size: 18px; color: #ee0a24; margin-left: 8px; }
</style>
