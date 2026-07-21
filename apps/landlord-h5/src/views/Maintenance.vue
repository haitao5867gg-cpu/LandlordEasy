<template>
  <div>
    <van-nav-bar title="维修记录" left-arrow @click-left="$router.back()">
      <template #right><van-icon name="plus" size="20" @click="showAdd = true" /></template>
    </van-nav-bar>
    <van-loading v-if="loading" class="page-loading" />
    <van-empty v-else-if="list.length === 0" description="暂无维修记录" />
    <van-cell-group v-else inset>
      <van-cell v-for="m in list" :key="m.id" :title="m.content" :label="`${m.room?.building?.name}${m.room?.roomNo} · ${m.date?.split('T')[0]}`" :value="`¥${m.cost}`" />
    </van-cell-group>

    <van-dialog v-model:show="showAdd" title="新增维修记录" show-cancel-button @confirm="handleAdd">
      <van-field v-model.number="form.roomId" label="房间ID" type="number" />
      <van-field v-model="form.date" label="日期" placeholder="YYYY-MM-DD" />
      <van-field v-model="form.content" label="内容" type="textarea" />
      <van-field v-model.number="form.cost" label="费用" type="number" />
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
const form = reactive({ roomId: 0, date: '', content: '', cost: 0 });

async function fetchList() { list.value = await http.get('/maintenance') as any; }
onMounted(async () => { try { await fetchList(); } finally { loading.value = false; } });

async function handleAdd() {
  await http.post('/maintenance', form);
  showToast('已添加');
  form.roomId = 0; form.date = ''; form.content = ''; form.cost = 0;
  await fetchList();
}
</script>
<style scoped>.page-loading { display: flex; justify-content: center; padding: 60px; }</style>
