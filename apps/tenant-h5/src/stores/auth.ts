import { defineStore } from 'pinia';
import { ref } from 'vue';

// 最近一次微信网页授权的时间戳。微信内置浏览器里JSAPI支付能力与"最近
// 一次网页授权"绑定,闲置数分钟后调起支付会报-1(2026-09-21两台手机10次
// 实测:授权3秒内支付全成功,授权9分钟以上全失败,刷新页面无效、重新授权
// 立即恢复)。实测盲区在10秒~5分钟之间,阈值从宽猜3分钟不如直接收紧到
// 10秒=每次人工点击支付前都无感保鲜一次;不能设0,否则授权回来自动续付
// 时会陷入"再授权"死循环(续付时距授权恰好几秒,10秒阈值正好放行)。
const AUTH_AT_KEY = 'tenant_auth_at';
export const PAY_AUTH_STALE_MS = 10 * 1000;

export function getAuthAt(): number {
  return Number(localStorage.getItem(AUTH_AT_KEY)) || 0;
}

export function markAuthJustDone() {
  localStorage.setItem(AUTH_AT_KEY, String(Date.now()));
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('tenant_token') || '');
  const bound = ref(localStorage.getItem('tenant_bound') === '1');

  function setToken(t: string) {
    token.value = t;
    localStorage.setItem('tenant_token', t);
  }

  function setBound(b: boolean) {
    bound.value = b;
    localStorage.setItem('tenant_bound', b ? '1' : '0');
  }

  function logout() {
    token.value = '';
    bound.value = false;
    localStorage.removeItem('tenant_token');
    localStorage.removeItem('tenant_bound');
  }

  return { token, bound, setToken, setBound, logout };
});
