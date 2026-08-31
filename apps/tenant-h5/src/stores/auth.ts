import { defineStore } from 'pinia';
import { ref } from 'vue';

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
