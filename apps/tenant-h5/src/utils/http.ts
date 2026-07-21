import axios from 'axios';
import { showToast } from 'vant';
import { useAuthStore } from '../stores/auth';
import router from '../router';

const http = axios.create({
  baseURL: '/api/v1',
  timeout: 15000,
});

http.interceptors.request.use((config) => {
  const authStore = useAuthStore();
  if (authStore.token) {
    config.headers.Authorization = `Bearer ${authStore.token}`;
  }
  return config;
});

http.interceptors.response.use(
  (response) => {
    const data = response.data;
    if (data.code !== undefined && data.code !== 0) {
      showToast(data.message || '请求失败');
      return Promise.reject(new Error(data.message));
    }
    return data.data !== undefined ? data.data : data;
  },
  (error) => {
    if (error.response?.status === 401) {
      const authStore = useAuthStore();
      authStore.logout();
      router.push('/login');
      showToast('登录已过期');
    } else {
      showToast(error.response?.data?.message || '网络错误');
    }
    return Promise.reject(error);
  },
);

export default http;
