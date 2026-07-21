<template>
  <div class="login-page">
    <div class="login-header">
      <h1>房东管理</h1>
      <p>LandlordEasy</p>
    </div>

    <!-- Mock 模式: 手动输入 openid -->
    <template v-if="isMockMode">
      <van-cell-group inset>
        <van-field v-model="openid" label="OpenID" placeholder="输入 mock_openid" />
      </van-cell-group>
      <div class="login-btn">
        <van-button type="primary" block :loading="loading" @click="handleLogin">
          登录
        </van-button>
      </div>
    </template>

    <!-- Real 模式: 跳转微信授权 -->
    <template v-else>
      <div class="login-btn">
        <van-button type="primary" block :loading="loading" @click="redirectToWechat">
          微信授权登录
        </van-button>
      </div>
      <p v-if="authError" class="error-text">{{ authError }}</p>
    </template>
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
const authError = ref('');

// 判断 mock 还是 real 模式
// 开发环境(localhost)默认 mock,生产环境默认 real
const isMockMode = ref(
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  !!route.query.mock_openid
);

onMounted(() => {
  // 从 URL 获取 mock_openid(开发模式)
  const mockOpenid = route.query.mock_openid as string;
  if (mockOpenid) {
    openid.value = mockOpenid;
    handleLogin();
    return;
  }

  // 真实模式: 检查微信回调带回的 code
  const code = route.query.code as string;
  if (code && !isMockMode.value) {
    handleWechatCallback(code);
  }
});

/** Mock 模式登录 */
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

/** 真实模式: 跳转微信授权页 */
function redirectToWechat() {
  const appId = import.meta.env.VITE_WECHAT_APPID || '';
  const redirectUri = encodeURIComponent(window.location.origin + '/login');
  const scope = 'snsapi_base'; // 静默授权
  const url = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${appId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=landlord#wechat_redirect`;
  window.location.href = url;
}

/** 真实模式: 微信回调处理 */
async function handleWechatCallback(code: string) {
  loading.value = true;
  try {
    const res = await http.post('/auth/landlord/login', { code });
    authStore.setToken((res as unknown as { token: string }).token);
    router.push('/');
  } catch (e: any) {
    authError.value = '登录失败,请重试';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page { padding: 80px 16px; }
.login-header { text-align: center; margin-bottom: 40px; }
.login-header h1 { font-size: 24px; margin-bottom: 8px; }
.login-header p { color: #999; }
.login-btn { margin-top: 24px; padding: 0 16px; }
.error-text { text-align: center; color: #ee0a24; margin-top: 16px; }
</style>
