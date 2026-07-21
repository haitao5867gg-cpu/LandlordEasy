import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('tenant_token') || '');
  const bound = ref(false);

  function setToken(t: string) {
    token.value = t;
    localStorage.setItem('tenant_token', t);
  }

  function setBound(b: boolean) { bound.value = b; }

  function logout() {
    token.value = '';
    bound.value = false;
    localStorage.removeItem('tenant_token');
  }

  return { token, bound, setToken, setBound, logout };
});
