<template>
  <div>
    <van-nav-bar title="空置看板" left-arrow @click-left="$router.back()" />
    <van-loading v-if="loading" class="page-loading" />
    <template v-else>
      <van-cell title="空置总数" :value="String(data.total)" />
      <van-empty v-if="data.total === 0" description="暂无空置房间" />
      <template v-else>
        <template v-for="(rooms, bName) in data.buildings" :key="bName">
          <van-cell-group inset :title="`${bName}(${rooms.length}间)`">
            <van-cell
              v-for="r in rooms"
              :key="r.id"
              :title="r.roomNo"
              :value="`空置${r.vacantDays}天`"
              is-link
              @click="$router.push('/rooms/' + r.id)"
            />
          </van-cell-group>
        </template>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import http from '../../utils/http';
import { usePropertyStore } from '../../stores/property';

const propertyStore = usePropertyStore();
const data = ref<any>({ total: 0, buildings: {} });
const loading = ref(true);

async function fetchVacancy() {
  loading.value = true;
  const params: Record<string, string> = {};
  if (propertyStore.currentPropertyId) params.propertyId = String(propertyStore.currentPropertyId);
  try {
    data.value = await http.get('/dashboard/vacancy', { params }) as any;
  } finally {
    loading.value = false;
  }
}

onMounted(fetchVacancy);
watch(() => propertyStore.currentPropertyId, () => {
  fetchVacancy();
});
</script>
<style scoped>.page-loading { display: flex; justify-content: center; padding: 60px; }</style>
