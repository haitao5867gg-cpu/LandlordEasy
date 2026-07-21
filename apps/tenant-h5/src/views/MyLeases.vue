<template>
  <div>
    <van-nav-bar title="我的租约" left-arrow @click-left="$router.back()" />
    <van-loading v-if="loading" class="page-loading" />
    <van-empty v-else-if="list.length === 0" description="暂无租约" />
    <van-cell-group v-else inset>
      <van-cell v-for="l in list" :key="l.id" :title="`${l.room?.building?.name} ${l.room?.roomNo}`" :label="`${l.startDate?.split('T')[0]} ~ ${l.endDate?.split('T')[0]}`">
        <template #value>
          <van-tag :type="l.status === 'ACTIVE' ? 'success' : 'default'">{{ l.status === 'ACTIVE' ? '在租' : '已退租' }}</van-tag>
        </template>
      </van-cell>
    </van-cell-group>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import http from '../utils/http';
const list = ref<any[]>([]);
const loading = ref(true);
onMounted(async () => { try { list.value = await http.get('/tenant/leases') as any; } finally { loading.value = false; } });
</script>
<style scoped>.page-loading { display: flex; justify-content: center; padding: 60px; }</style>
