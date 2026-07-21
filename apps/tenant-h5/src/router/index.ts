import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('../views/Login.vue') },
    { path: '/', name: 'home', component: () => import('../views/MyBills.vue') },
    { path: '/leases', name: 'leases', component: () => import('../views/MyLeases.vue') },
    { path: '/bills/:id/pay', name: 'pay', component: () => import('../views/PayBill.vue') },
  ],
});

router.beforeEach((to) => {
  const authStore = useAuthStore();
  if (to.path !== '/login' && !authStore.token) {
    return '/login';
  }
});

export default router;
