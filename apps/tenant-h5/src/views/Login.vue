<template>
  <div class="login-page">
    <div class="login-header">
      <h1>租客端</h1>
      <p>LandlordEasy</p>
    </div>

    <!-- 登录表单 -->
    <van-cell-group v-if="!loggedIn" inset>
      <van-field v-model="openid" label="OpenID" placeholder="输入 mock_openid" />
      <div style="padding:16px;"><van-button type="primary" block :loading="loginLoading" @click="handleLogin">登录</van-button></div>
    </van-cell-group>

    <!-- 绑定邀请码 -->
    <van-cell-group v-else-if="!authStore.bound" inset>
      <p style="padding:16px;color:#666;">首次使用请输入房东提供的邀请码绑定租约</p>
      <van-field v-model="inviteCode" label="邀请码" placeholder="输入邀请码" />
      <div style="padding:16px;"><van-button type="primary" block :loading="bindLoading" @click="handleBind">绑定</van-button></div>
    </van-cell-group>
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

onMounted(() => {
  const mockOpenid = route.query.mock_openid as string;
  if (mockOpenid) { openid.value = mockOpenid; handleLogin(); }
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

async function handleBind() {
  if (!inviteCode.value) { showToast('请输入邀请码'); return; }
  bindLoading.value = true;
  try {
    const res = await http.post('/tenant/bind', { inviteCode: inviteCode.value }) as any;
    // bind 成功后返回刷新的 JWT
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
</style>
