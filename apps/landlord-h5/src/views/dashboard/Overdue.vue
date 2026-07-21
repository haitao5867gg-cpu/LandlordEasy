<template>
  <div>
    <van-nav-bar title="逾期看板" left-arrow @click-left="$router.back()" />
    <van-loading v-if="loading" class="page-loading" />
    <template v-else>
      <van-cell title="逾期总数" :value="String(data.total)" />
      <template v-for="(items, bName) in data.buildings" :key="bName">
        <van-cell-group inset :title="`${bName}`">
          <van-cell v-for="item in items" :key="item.billId" :title="`${item.roomNo} - ${item.tenantName}`" :label="`逾期${item.overdueDays}天`" :value="`¥${item.amount}`" />
        </van-cell-group>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import http from '../../utils/http';
const data = ref<any>({ total: 0, buildings: {} });
const loading = ref(true);
onMounted(async () => { try { data.value = await http.get('/dashboard/overdue') as any; } finally { loading.value = false; } });
</script>
<style scoped>.page-loading { display: flex; justify-content: center; padding: 60px; }</style>
