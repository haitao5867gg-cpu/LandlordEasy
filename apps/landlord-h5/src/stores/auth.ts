import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('landlord_token') || '');

  function setToken(t: string) {
    token.value = t;
    localStorage.setItem('landlord_token', t);
  }

  function logout() {
    token.value = '';
    localStorage.removeItem('landlord_token');
  }

  return { token, setToken, logout };
});
