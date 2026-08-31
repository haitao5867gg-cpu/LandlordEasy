<template>
  <div class="overdue-page" :class="{ 'is-batch-mode': batchMode }">
    <van-nav-bar title="逾期看板" left-arrow @click-left="$router.back()">
      <template #right>
        <van-button size="small" plain type="primary" @click="toggleBatchMode">
          {{ batchMode ? '取消' : '批量催' }}
        </van-button>
      </template>
    </van-nav-bar>
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
              :is-link="!batchMode"
              @click="handleItemClick(item.billId)"
            >
              <template v-if="batchMode" #icon>
                <van-checkbox
                  class="bill-checkbox"
                  :model-value="selectedBillIds.includes(item.billId)"
                  @update:model-value="(checked) => setSelected(item.billId, checked)"
                  @click.stop
                />
              </template>
            </van-cell>
          </van-cell-group>
        </template>
      </template>
    </template>

    <div v-if="batchMode" class="batch-bar van-safe-area-bottom">
      <van-button
        block
        type="primary"
        :disabled="selectedBillIds.length === 0"
        :loading="batchReminding"
        @click="handleBatchRemind"
      >
        催选中的{{ selectedBillIds.length }}个
      </van-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import http from '../../utils/http';
import { usePropertyStore } from '../../stores/property';

interface BatchRemindResult {
  succeeded: number[];
  skipped: Array<{ billId: number; reason: string }>;
}

const router = useRouter();
const propertyStore = usePropertyStore();
const data = ref<any>({ total: 0, buildings: {} });
const loading = ref(true);
const batchMode = ref(false);
const batchReminding = ref(false);
const selectedBillIds = ref<number[]>([]);

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

function toggleBatchMode() {
  batchMode.value = !batchMode.value;
  selectedBillIds.value = [];
}

function setSelected(billId: number, checked: boolean) {
  selectedBillIds.value = checked
    ? [...selectedBillIds.value, billId]
    : selectedBillIds.value.filter((id) => id !== billId);
}

function handleItemClick(billId: number) {
  if (!batchMode.value) {
    router.push(`/bills/${billId}`);
    return;
  }
  setSelected(billId, !selectedBillIds.value.includes(billId));
}

async function handleBatchRemind() {
  if (selectedBillIds.value.length === 0) return;
  batchReminding.value = true;
  try {
    const result = await http.post('/bills/batch-remind', {
      billIds: selectedBillIds.value,
    }) as BatchRemindResult;
    showToast(`${result.succeeded.length}条已发送,${result.skipped.length}条跳过`);
    batchMode.value = false;
    selectedBillIds.value = [];
    await fetchOverdue();
  } catch {
    // HTTP 拦截器统一展示后端返回的错误文案
  } finally {
    batchReminding.value = false;
  }
}

onMounted(fetchOverdue);
watch(() => propertyStore.currentPropertyId, () => {
  batchMode.value = false;
  selectedBillIds.value = [];
  fetchOverdue();
});
</script>

<style scoped>
.page-loading { display: flex; justify-content: center; padding: 60px; }
.is-batch-mode { padding-bottom: 76px; }
.bill-checkbox { margin-right: 12px; }
.batch-bar {
  position: fixed;
  z-index: 10;
  right: 0;
  bottom: 0;
  left: 0;
  padding: 12px 16px;
  background: #fff;
  box-shadow: 0 -2px 8px rgb(0 0 0 / 8%);
}
</style>
