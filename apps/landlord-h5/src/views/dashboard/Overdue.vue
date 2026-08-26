<template>
  <div>
    <van-nav-bar title="逾期看板" left-arrow @click-left="$router.back()" />
    <van-loading v-if="loading" class="page-loading" />
    <template v-else>
      <van-cell title="逾期总数" :value="String(data.total)" />
      <van-empty v-if="data.total === 0" description="暂无逾期账单" />
      <template v-else>
        <template v-for="(items, bName) in data.buildings" :key="bName">
          <van-cell-group inset :title="`${bName}`">
            <van-cell
              v-for="item in items"
              :key="item.billId"
              :title="`${item.roomNo} - ${item.tenantName}`"
              :label="`逾期${item.overdueDays}天`"
              :value="`¥${item.amount}`"
              is-link
              @click="$router.push('/bills/' + item.billId)"
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

async function fetchOverdue() {
  loading.value = true;
  const params: Record<string, string> = {};
  if (propertyStore.currentPropertyId) params.propertyId = String(propertyStore.currentPropertyId);
  try {
    data.value = await http.get('/dashboard/overdue', { params }) as any;
  } finally {
    loading.value = false;
  }
}

onMounted(fetchOverdue);
watch(() => propertyStore.currentPropertyId, () => {
  fetchOverdue();
});
</script>
<style scoped>.page-loading { display: flex; justify-content: center; padding: 60px; }</style>
