<template>
  <div class="login-page">
    <div class="login-header">
      <h1>房东管理</h1>
      <p>LandlordEasy</p>
    </div>
    <van-cell-group inset>
      <van-field v-model="openid" label="OpenID" placeholder="输入 mock_openid" />
    </van-cell-group>
    <div class="login-btn">
      <van-button type="primary" block :loading="loading" @click="handleLogin">
        登录
      </van-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { showToast } from 'vant';
import http from '../utils/http';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();
const openid = ref('');
const loading = ref(false);

onMounted(() => {
  // 从 URL 获取 mock_openid
  const mockOpenid = route.query.mock_openid as string;
  if (mockOpenid) {
    openid.value = mockOpenid;
    handleLogin();
  }
});

async function handleLogin() {
  if (!openid.value) {
    showToast('请输入 OpenID');
    return;
  }
  loading.value = true;
  try {
    const res = await http.post('/auth/landlord/login', { code: openid.value });
    authStore.setToken((res as unknown as { token: string }).token);
    router.push('/');
  } catch {
    // 错误已由拦截器处理
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  padding: 80px 16px;
}
.login-header {
  text-align: center;
  margin-bottom: 40px;
}
.login-header h1 {
  font-size: 24px;
  margin-bottom: 8px;
}
.login-header p {
  color: #999;
}
.login-btn {
  margin-top: 24px;
  padding: 0 16px;
}
</style>
