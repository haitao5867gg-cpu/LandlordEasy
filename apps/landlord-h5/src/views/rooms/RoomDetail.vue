<template>
  <div>
    <van-nav-bar :title="`房间 ${room?.roomNo || ''}`" left-arrow @click-left="$router.back()">
      <template #right>
        <van-button v-if="room?.status === 'VACANT'" size="small" type="primary" @click="$router.push(`/leases/new?roomId=${room.id}`)">新签租约</van-button>
      </template>
    </van-nav-bar>
    <van-loading v-if="loading" class="page-loading" />
    <template v-else-if="room">
      <van-cell-group inset title="基本信息">
        <van-cell title="楼栋" :value="room.building?.name" />
        <van-cell title="房号" :value="room.roomNo" />
        <van-cell title="楼层" :value="String(room.floor)" />
        <van-cell title="状态">
          <template #value>
            <van-tag :type="room.status === 'RENTED' ? 'success' : 'default'">{{ statusMap[room.status] || room.status }}</van-tag>
          </template>
        </van-cell>
        <van-cell v-if="currentDebt > 0" title="当前欠费" :value="`¥${currentDebt.toFixed(2)}`" value-class="debt-value" />
      </van-cell-group>

      <van-tabs v-model:active="activeTab" class="detail-tabs">
        <van-tab title="租约">
          <van-empty v-if="!room.leases?.length" description="暂无租约" />
          <van-cell-group v-else inset>
            <van-cell
              v-for="lease in room.leases"
              :key="lease.id"
              :title="lease.tenant?.name"
              :label="`${lease.startDate?.split('T')[0]} ~ ${lease.endDate?.split('T')[0]}`"
              is-link
              @click="$router.push(`/leases/${lease.id}`)"
            >
              <template #value>
                <van-tag :type="lease.status === 'ACTIVE' ? 'success' : 'default'">{{ lease.status === 'ACTIVE' ? '在租' : '已退' }}</van-tag>
              </template>
            </van-cell>
          </van-cell-group>
        </van-tab>
        <van-tab title="维修记录">
          <van-empty v-if="!room.maintenanceRecords?.length" description="暂无记录" />
          <van-cell-group v-else inset>
            <van-cell v-for="m in room.maintenanceRecords" :key="m.id" :title="m.content" :label="m.date?.split('T')[0]" :value="`¥${m.cost}`" />
          </van-cell-group>
        </van-tab>
        <van-tab title="支出">
          <van-empty v-if="!room.expenses?.length" description="暂无支出" />
          <van-cell-group v-else inset>
            <van-cell v-for="e in room.expenses" :key="e.id" :title="e.name" :label="e.date?.split('T')[0]" :value="`¥${e.amount}`" />
          </van-cell-group>
        </van-tab>
        <van-tab title="操作日志">
          <van-empty v-if="!room.auditLogs?.length" description="暂无日志" />
          <van-cell-group v-else inset>
            <van-cell
              v-for="log in room.auditLogs"
              :key="log.id"
              :title="auditActionText(log.action)"
              :label="`${log.operatorName || '系统'} · ${log.createdAt?.replace('T',' ').slice(0,19)}`"
            />
          </van-cell-group>
        </van-tab>
      </van-tabs>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import http from '../../utils/http';
import { roomStatusMap } from '../../utils/status';

// 操作日志从接口原文翻译成人话(2026-09-21 GasCan反馈"都是接口日志看不懂")。
// 只覆盖已知的路由模式,没匹配到的原样展示,新增接口时在这里补一行即可。
const AUDIT_ACTION_PATTERNS: Array<[RegExp, string]> = [
  [/^POST \/api\/v1\/properties$/, '创建公寓'],
  [/^PUT \/api\/v1\/properties\/\d+$/, '修改公寓信息'],
  [/^POST \/api\/v1\/buildings$/, '创建楼栋'],
  [/^POST \/api\/v1\/rooms\/batch$/, '批量创建房间'],
  [/^PUT \/api\/v1\/rooms\/\d+$/, '修改房间信息'],
  [/^POST \/api\/v1\/leases$/, '新签租约'],
  [/^PUT \/api\/v1\/leases\/\d+$/, '修改租约'],
  [/^POST \/api\/v1\/leases\/\d+\/co-occupants$/, '登记共同居住人'],
  [/^POST \/api\/v1\/leases\/\d+\/bind-qrcode$/, '生成租客绑定二维码'],
  [/^POST \/api\/v1\/leases\/\d+\/contract-signing-tasks$/, '发起电子签约'],
  [/^POST \/api\/v1\/leases\/contract-signing-tasks\/\d+\/launch$/, '发起微签签署'],
  [/^POST \/api\/v1\/handover$/, '登记房屋交接'],
  [/^POST \/api\/v1\/bills\/\d+\/remind$/, '发送账单催缴提醒'],
  [/^POST \/api\/v1\/bills\/generate$/, '手动生成账单'],
];

function auditActionText(action: string): string {
  for (const [pattern, text] of AUDIT_ACTION_PATTERNS) {
    if (pattern.test(action)) return text;
  }
  return action;
}

const route = useRoute();
const room = ref<any>(null);
const loading = ref(true);
const activeTab = ref(0);
const statusMap = roomStatusMap;

const currentDebt = computed(() => {
  if (!room.value?.leases) return 0;
  let debt = 0;
  for (const lease of room.value.leases) {
    if (lease.status !== 'ACTIVE') continue;
    for (const bill of lease.bills || []) {
      if (['PENDING', 'OVERDUE'].includes(bill.status)) {
        debt += Number(bill.totalAmount);
      }
    }
  }
  return debt;
});

onMounted(async () => {
  try {
    room.value = await http.get(`/rooms/${route.params.id}`);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.page-loading { display: flex; justify-content: center; padding: 60px; }
/* tabs卡片化:与上方inset信息卡同语言——左右留边、圆角、不紧贴 */
.detail-tabs {
  margin: 12px 16px 0;
  border-radius: 8px;
  overflow: hidden;
}
.detail-tabs :deep(.van-tabs__content) {
  padding-top: 12px;
}
</style>
