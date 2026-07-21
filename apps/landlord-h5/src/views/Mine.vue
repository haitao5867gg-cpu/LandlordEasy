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
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
const router = useRouter();
const authStore = useAuthStore();
function handleLogout() { authStore.logout(); router.push('/login'); }
</script>
<style scoped>.mine-page { padding-bottom: 60px; }</style>
