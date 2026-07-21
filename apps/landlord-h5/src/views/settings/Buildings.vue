<template>
  <div>
    <van-nav-bar title="楼栋管理" left-arrow @click-left="$router.back()">
      <template #right><van-icon name="plus" size="20" @click="showAdd = true" /></template>
    </van-nav-bar>
    <van-cell-group inset>
      <van-cell v-for="b in list" :key="b.id" :title="b.name" :value="`排序: ${b.sort}`" />
    </van-cell-group>
    <van-dialog v-model:show="showAdd" title="添加楼栋" show-cancel-button @confirm="handleAdd">
      <van-field v-model="form.name" label="名称" />
      <van-field v-model.number="form.sort" label="排序" type="number" />
    </van-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { showToast } from 'vant';
import http from '../../utils/http';
const list = ref<any[]>([]);
const showAdd = ref(false);
const form = reactive({ name: '', sort: 0 });
async function fetchList() { list.value = await http.get('/buildings') as any; }
onMounted(fetchList);
async function handleAdd() {
  await http.post('/buildings', form);
  showToast('已添加');
  form.name = ''; form.sort = 0;
  await fetchList();
}
</script>
