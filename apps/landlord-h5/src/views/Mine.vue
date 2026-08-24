<template>
  <div class="mine-page">
    <van-nav-bar title="我的" />
    <van-cell-group inset>
      <van-cell title="经营报表" is-link @click="$router.push('/reports')" icon="chart-trending-o" />
      <van-cell title="维修记录" is-link @click="$router.push('/maintenance')" icon="service-o" />
      <van-cell title="支出管理" is-link @click="$router.push('/expenses')" icon="balance-list-o" />
      <van-cell title="系统设置" is-link @click="$router.push('/settings')" icon="setting-o" />
    </van-cell-group>
    <div style="padding:32px 16px;">
      <van-button block plain type="danger" @click="handleLogout">退出登录</van-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { showConfirmDialog } from 'vant';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
const router = useRouter();
const authStore = useAuthStore();
async function handleLogout() {
  try {
    await showConfirmDialog({ title: '退出登录', message: '确定要退出登录吗?' });
    authStore.logout();
    router.push('/login');
  } catch { /* 用户取消 */ }
}
</script>