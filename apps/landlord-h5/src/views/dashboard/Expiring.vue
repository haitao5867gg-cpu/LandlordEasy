<template>
  <div>
    <van-nav-bar title="到期预警" left-arrow @click-left="$router.back()" />
    <van-loading v-if="loading" class="page-loading" />
    <van-empty v-else-if="list.length === 0" description="暂无即将到期租约" />
    <van-cell-group v-else inset>
      <van-cell
        v-for="item in list"
        :key="item.id"
        :title="`${item.room?.building?.name} ${item.room?.roomNo} - ${item.tenant?.name}`"
        :label="`到期日: ${item.endDate?.split('T')[0]}`"
        :value="`${item.daysLeft}天后到期`"
        is-link
        @click="$router.push(`/leases/${item.id}`)"
      />
    </van-cell-group>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import http from '../../utils/http';
const list = ref<any[]>([]);
const loading = ref(true);
onMounted(async () => { try { list.value = await http.get('/dashboard/expiring') as any; } finally { loading.value = false; } });
</script>
<style scoped>.page-loading { display: flex; justify-content: center; padding: 60px; }</style>
