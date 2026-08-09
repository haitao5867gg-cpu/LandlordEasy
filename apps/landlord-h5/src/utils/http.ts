import axios from 'axios';
import { showToast } from 'vant';
import { useAuthStore } from '../stores/auth';
import router from '../router';

const http = axios.create({
  baseURL: '/api/v1',
  timeout: 15000,
});

export function getHttpErrorMessage(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error.message : '网络错误';
  }

  const message = error.response?.data?.message;
  if (Array.isArray(message)) return message.join('；');
  return typeof message === 'string' && message ? message : error.message || '网络错误';
}

function isLoginRequest(url?: string): boolean {
  return /\/auth\/(?:landlord|tenant)\/login(?:\?|$)/.test(url || '');
}

// 请求拦截器: 自动带 token
http.interceptors.request.use((config) => {
  const authStore = useAuthStore();
  if (authStore.token) {
    config.headers.Authorization = `Bearer ${authStore.token}`;
  }
  return config;
});

// 响应拦截器: 统一错误处理
http.interceptors.response.use(
  (response) => {
    const data = response.data;
    // 统一响应格式 {code, message, data}
    if (data.code !== undefined && data.code !== 0) {
      showToast(data.message || '请求失败');
      return Promise.reject(new Error(data.message));
    }
    return data.data !== undefined ? data.data : data;
  },
  (error) => {
    const authStore = useAuthStore();
    const isExpiredSession =
      error.response?.status === 401 &&
      Boolean(authStore.token) &&
      !isLoginRequest(error.config?.url);

    if (isExpiredSession) {
      authStore.logout();
      router.push('/login');
      showToast('登录已过期,请重新登录');
    } else {
      showToast(getHttpErrorMessage(error));
    }
    return Promise.reject(error);
  },
);

export default http;
