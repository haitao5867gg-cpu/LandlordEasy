import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = createRouter({
  history: createWebHistory('/tenant/'),
  routes: [
    { path: '/login', name: 'login', component: () => import('../views/Login.vue') },
    { path: '/', name: 'home', component: () => import('../views/MyBills.vue') },
    { path: '/leases', name: 'leases', component: () => import('../views/MyLeases.vue') },
    { path: '/bills/:id/pay', name: 'pay', component: () => import('../views/PayBill.vue') },
  ],
});

router.beforeEach((to) => {
  const authStore = useAuthStore();
  // 已登录且已绑定的用户,如果直接停留/跳转到登录页(不是刚从微信授权跳回来
  // 带着 code 的那一次),应该自动跳首页,不能停留在登录页——否则 Login.vue
  // 里"未登录显示登录按钮"和"已登录未绑定显示邀请码表单"这两个条件都不成立,
  // 页面会渲染出一片空白(2026-08-31 M18真实支付测试踩过,bound 状态改成持久
  // 化之后才暴露出这个原本就存在、但被"总会显示邀请码表单"这个副作用掩盖掉
  // 的路由守卫遗漏)。
  if (to.path === '/login' && authStore.token && authStore.bound && !to.query.code) {
    return { path: '/' };
  }
  if (to.path !== '/login' && !authStore.token) {
    return { path: '/login', query: to.query };
  }
});

export default router;
