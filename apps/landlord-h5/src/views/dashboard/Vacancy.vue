<template>
  <div>
    <van-nav-bar title="空置看板" left-arrow @click-left="$router.back()" />
    <van-loading v-if="loading" class="page-loading" />
    <template v-else>
      <van-cell title="空置总数" :value="String(data.total)" />
      <template v-for="(rooms, bName) in data.buildings" :key="bName">
        <van-cell-group inset :title="`${bName}(${rooms.length}间)`">
          <van-cell v-for="r in rooms" :key="r.id" :title="r.roomNo" :value="`空置${r.vacantDays}天`" />
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
onMounted(async () => { try { data.value = await http.get('/dashboard/vacancy') as any; } finally { loading.value = false; } });
</script>
<style scoped>.page-loading { display: flex; justify-content: center; padding: 60px; }</style>
