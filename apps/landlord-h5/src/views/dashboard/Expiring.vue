<template>
  <div>
    <van-nav-bar title="到期预警" left-arrow @click-left="$router.back()" />
    <van-notice-bar
      left-icon="info-o"
      text="列表含已过期但仍在租的租约(历史数据常见),建议尽快续签或办理退租"
      wrapable
    />
    <van-loading v-if="loading" class="page-loading" />
    <van-empty v-else-if="list.length === 0" description="暂无即将到期租约" />
    <van-cell-group v-else inset>
      <van-cell
        v-for="item in list"
        :key="item.id"
        :title="`${item.room?.building?.name} ${item.room?.roomNo} - ${item.tenant?.name}`"
        :label="`到期日: ${item.endDate?.split('T')[0]}`"
        :value="daysLeftLabel(item.daysLeft)"
        is-link
        @click="$router.push(`/leases/${item.id}`)"
      />
    </van-cell-group>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import http from '../../utils/http';
import { usePropertyStore } from '../../stores/property';

const propertyStore = usePropertyStore();
const list = ref<any[]>([]);
const loading = ref(true);

/** daysLeft为负 = 租约已过期但还在租(历史数据常见),不能显示"-50天后到期" */
function daysLeftLabel(daysLeft: number): string {
  if (typeof daysLeft !== 'number' || Number.isNaN(daysLeft)) return '到期状态未知';
  if (daysLeft < 0) return `已过期${-daysLeft}天`;
  if (daysLeft === 0) return '今天到期';
  return `${daysLeft}天后到期`;
}

async function fetchExpiring() {
  loading.value = true;
  const params: Record<string, string> = {};
  if (propertyStore.currentPropertyId) params.propertyId = String(propertyStore.currentPropertyId);
  try {
    list.value = await http.get('/dashboard/expiring', { params }) as any;
  } finally {
    loading.value = false;
  }
}

onMounted(fetchExpiring);
watch(() => propertyStore.currentPropertyId, () => {
  fetchExpiring();
});
</script>
<style scoped>.page-loading { display: flex; justify-content: center; padding: 60px; }</style>
