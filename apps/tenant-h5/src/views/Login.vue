<template>
  <div class="login-page">
    <div class="login-header">
      <h1>租客端</h1>
      <p>LandlordEasy</p>
    </div>

    <!-- Mock 模式 -->
    <template v-if="isMockMode">
      <van-cell-group v-if="!loggedIn" inset>
        <van-field v-model="openid" label="OpenID" placeholder="输入 mock_openid" />
        <div style="padding:16px;"><van-button type="primary" block :loading="loginLoading" @click="handleLogin">登录</van-button></div>
      </van-cell-group>
    </template>

    <!-- Real 模式: 自动跳转微信授权 -->
    <template v-else>
      <div v-if="!loggedIn" class="login-btn">
        <van-button type="primary" block :loading="loginLoading" @click="redirectToWechat">微信授权登录</van-button>
      </div>
    </template>

    <!-- 绑定邀请码(登录后、未绑定时显示) -->
    <van-cell-group v-if="loggedIn && !authStore.bound" inset>
      <p style="padding:16px;color:#666;">首次使用请输入房东提供的邀请码绑定租约</p>
      <van-field v-model="inviteCode" label="邀请码" placeholder="输入邀请码" />
      <div style="padding:16px;"><van-button type="primary" block :loading="bindLoading" @click="handleBind">绑定</van-button></div>
    </van-cell-group>

    <p v-if="authError" class="error-text">{{ authError }}</p>
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
const inviteCode = ref('');
const loginLoading = ref(false);
const bindLoading = ref(false);
const loggedIn = ref(!!authStore.token);
const authError = ref('');

const isMockMode = ref(
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  !!route.query.mock_openid
);

onMounted(() => {
  // Mock 模式自动登录
  const mockOpenid = route.query.mock_openid as string;
  if (mockOpenid) {
    openid.value = mockOpenid;
    handleLogin();
    return;
  }

  // Real 模式: 检查微信回调 code
  const code = route.query.code as string;
  if (code && !isMockMode.value) {
    handleWechatCallback(code);
  }
});

async function handleLogin() {
  if (!openid.value) { showToast('请输入OpenID'); return; }
  loginLoading.value = true;
  try {
    const res = await http.post('/auth/tenant/login', { code: openid.value }) as any;
    authStore.setToken(res.token);
    loggedIn.value = true;
    if (res.bound) {
      authStore.setBound(true);
      router.push('/');
    }
  } finally { loginLoading.value = false; }
}

function redirectToWechat() {
  const appId = import.meta.env.VITE_WECHAT_APPID || '';
  const redirectUri = encodeURIComponent(window.location.origin + '/login');
  const scope = 'snsapi_base';
  const url = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${appId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=tenant#wechat_redirect`;
  window.location.href = url;
}

async function handleWechatCallback(code: string) {
  loginLoading.value = true;
  try {
    const res = await http.post('/auth/tenant/login', { code }) as any;
    authStore.setToken(res.token);
    loggedIn.value = true;
    if (res.bound) {
      authStore.setBound(true);
      router.push('/');
    }
  } catch {
    authError.value = '登录失败,请重试';
  } finally { loginLoading.value = false; }
}

async function handleBind() {
  if (!inviteCode.value) { showToast('请输入邀请码'); return; }
  bindLoading.value = true;
  try {
    const res = await http.post('/tenant/bind', { inviteCode: inviteCode.value }) as any;
    if (res.token) authStore.setToken(res.token);
    authStore.setBound(true);
    showToast('绑定成功');
    router.push('/');
  } finally { bindLoading.value = false; }
}
</script>

<style scoped>
.login-page { padding: 60px 16px; }
.login-header { text-align: center; margin-bottom: 32px; }
.login-header h1 { font-size: 22px; }
.login-header p { color: #999; }
.login-btn { padding: 0 16px; margin-top: 24px; }
.error-text { text-align: center; color: #ee0a24; margin-top: 16px; }
</style>
