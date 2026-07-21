<template>
  <div>
    <van-nav-bar title="房型模板" left-arrow @click-left="$router.back()">
      <template #right><van-icon name="plus" size="20" @click="showAdd = true" /></template>
    </van-nav-bar>
    <van-cell-group inset>
      <van-cell v-for="rt in list" :key="rt.id" :title="rt.name" :label="rt.description" :value="`¥${rt.defaultRent}/月`" />
    </van-cell-group>
    <van-dialog v-model:show="showAdd" title="添加房型" show-cancel-button @confirm="handleAdd">
      <van-field v-model="form.name" label="名称" />
      <van-field v-model="form.description" label="描述" />
      <van-field v-model.number="form.defaultRent" label="默认租金" type="number" />
      <van-field v-model.number="form.defaultDeposit" label="默认押金" type="number" />
    </van-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { showToast } from 'vant';
import http from '../../utils/http';
const list = ref<any[]>([]);
const showAdd = ref(false);
const form = reactive({ name: '', description: '', defaultRent: 0, defaultDeposit: 0 });
async function fetchList() { list.value = await http.get('/room-types') as any; }
onMounted(fetchList);
async function handleAdd() {
  await http.post('/room-types', form);
  showToast('已添加');
  form.name = ''; form.description = ''; form.defaultRent = 0; form.defaultDeposit = 0;
  await fetchList();
}
</script>
