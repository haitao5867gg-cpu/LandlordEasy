<template>
  <div>
    <van-nav-bar title="白名单管理" left-arrow @click-left="$router.back()">
      <template #right><van-icon name="plus" size="20" @click="showAdd = true" /></template>
    </van-nav-bar>
    <van-cell-group inset>
      <van-cell v-for="l in list" :key="l.id" :title="l.name" :label="l.openid">
        <template #value>
          <van-tag :type="l.isActive ? 'success' : 'default'">{{ l.isActive ? '启用' : '禁用' }}</van-tag>
          <van-button v-if="l.isActive" size="mini" type="danger" style="margin-left:8px" @click="handleDisable(l.id)">禁用</van-button>
        </template>
      </van-cell>
    </van-cell-group>
    <van-dialog v-model:show="showAdd" title="添加房东" show-cancel-button @confirm="handleAdd">
      <van-field v-model="form.openid" label="OpenID" />
      <van-field v-model="form.name" label="姓名" />
    </van-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { showToast } from 'vant';
import http from '../../utils/http';
const list = ref<any[]>([]);
const showAdd = ref(false);
const form = reactive({ openid: '', name: '' });

async function fetchList() { list.value = await http.get('/admin/landlords') as any; }
onMounted(fetchList);

async function handleAdd() {
  await http.post('/admin/landlords', form);
  showToast('已添加');
  form.openid = ''; form.name = '';
  await fetchList();
}

async function handleDisable(id: number) {
  try {
    await http.delete(`/admin/landlords/${id}`);
    showToast('已禁用');
    await fetchList();
  } catch { /* error handled by interceptor */ }
}
</script>
