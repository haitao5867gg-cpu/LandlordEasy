<template>
  <div>
    <van-nav-bar title="支出管理" left-arrow @click-left="$router.back()">
      <template #right><van-icon name="plus" size="20" @click="showAdd = true" /></template>
    </van-nav-bar>
    <van-loading v-if="loading" class="page-loading" />
    <van-empty v-else-if="list.length === 0" description="暂无支出" />
    <van-cell-group v-else inset>
      <van-cell v-for="e in list" :key="e.id" :title="e.name" :label="`${e.category} · ${e.date?.split('T')[0]}`" :value="`¥${e.amount}`" />
    </van-cell-group>

    <van-dialog v-model:show="showAdd" title="新增支出" show-cancel-button @confirm="handleAdd">
      <van-field v-model="form.date" label="日期" placeholder="YYYY-MM-DD" />
      <van-field v-model="form.category" label="类目" placeholder="如:网费/工资" />
      <van-field v-model="form.name" label="名称" />
      <van-field v-model.number="form.amount" label="金额" type="number" />
      <van-field v-model="form.remark" label="备注" placeholder="可选" />
    </van-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { showToast } from 'vant';
import http from '../utils/http';
const list = ref<any[]>([]);
const loading = ref(true);
const showAdd = ref(false);
const form = reactive({ date: '', category: '', name: '', amount: 0, remark: '' });

async function fetchList() { list.value = await http.get('/expenses') as any; }
onMounted(async () => { try { await fetchList(); } finally { loading.value = false; } });

async function handleAdd() {
  await http.post('/expenses', form);
  showToast('已添加');
  form.date = ''; form.category = ''; form.name = ''; form.amount = 0; form.remark = '';
  await fetchList();
}
</script>
<style scoped>.page-loading { display: flex; justify-content: center; padding: 60px; }</style>
