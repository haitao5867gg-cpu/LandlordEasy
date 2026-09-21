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

    <!-- 未绑定(正常情况下不会出现,绑定应该在关注公众号那一步就已完成) -->
    <van-cell-group v-if="unboundTip || (loggedIn && !authStore.bound)" inset>
      <p style="padding:16px;color:#666;">尚未绑定账号,请联系房东获取绑定二维码,微信扫码关注公众号完成绑定</p>
    </van-cell-group>

    <p v-if="authError" class="error-text">{{ authError }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { showToast } from 'vant';
import http from '../utils/http';
import { useAuthStore, markAuthJustDone } from '../stores/auth';
import { redirectToWechatAuth, isInWechatBrowser } from '../utils/wechat-oauth';

// 授权回来后要回到的目标页面(支付前无感重授权时由PayBill写入)
const AFTER_LOGIN_KEY = 'tenant_after_login';

function redirectToWechat() {
  redirectToWechatAuth();
}

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();
const openid = ref('');
const loginLoading = ref(false);
const loggedIn = ref(!!authStore.token);
const authError = ref('');
const unboundTip = ref(false);

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
    return;
  }

  // 微信内打开时免点按钮直接静默授权(snsapi_base无感)——2026-09-21 GasCan
  // 反馈:从服务号菜单/消息进来的租客不该先看到一个"微信授权登录"按钮。
  // 非微信浏览器(如Safari)保留按钮,授权页需要微信登录态,自动跳过去体验更差。
  if (
    !isMockMode.value &&
    !authStore.token &&
    /MicroMessenger/i.test(navigator.userAgent)
  ) {
    redirectToWechat();
  }
});

async function handleLogin() {
  if (!openid.value) { showToast('请输入OpenID'); return; }
  loginLoading.value = true;
  try {
    const res = await http.post('/auth/tenant/login', { code: openid.value }) as any;
    applyLoginResult(res);
  } finally { loginLoading.value = false; }
}

async function handleWechatCallback(code: string) {
  loginLoading.value = true;
  try {
    const res = await http.post('/auth/tenant/login', { code }) as any;
    applyLoginResult(res);
  } catch {
    authError.value = '登录失败,请重试';
  } finally { loginLoading.value = false; }
}

// 未绑定的openid不发token:之前会把"无租客"的token存下来,后续接口全部
// 报"未绑定租约",租客完全看不懂(2026-09-21 GasCan实测反馈)。未绑定就
// 停在本页并展示引导文案,下次进入重新静默授权,绑定完成后自然进得去。
function applyLoginResult(res: { token: string; bound: boolean }) {
  if (res.bound) {
    authStore.setToken(res.token);
    authStore.setBound(true);
    loggedIn.value = true;
    markAuthJustDone();
    // 支付前无感重授权的场景:回到支付页继续,而不是默认首页
    const afterLogin = sessionStorage.getItem(AFTER_LOGIN_KEY);
    if (afterLogin) {
      sessionStorage.removeItem(AFTER_LOGIN_KEY);
      router.push(afterLogin);
    } else {
      router.push('/');
    }
    return;
  }
  authStore.logout();
  loggedIn.value = false;
  unboundTip.value = true;
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
