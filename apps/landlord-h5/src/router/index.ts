import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('../views/Login.vue') },
    { path: '/', name: 'home', component: () => import('../views/Home.vue') },
    { path: '/rooms', name: 'rooms', component: () => import('../views/rooms/RoomList.vue') },
    { path: '/rooms/batch-create', name: 'batchCreate', component: () => import('../views/rooms/BatchCreate.vue') },
    { path: '/rooms/:id', name: 'roomDetail', component: () => import('../views/rooms/RoomDetail.vue') },
    { path: '/leases/new', name: 'newLease', component: () => import('../views/leases/NewLease.vue') },
    { path: '/leases/:id', name: 'leaseDetail', component: () => import('../views/leases/LeaseDetail.vue') },
    { path: '/bills', name: 'bills', component: () => import('../views/bills/BillList.vue') },
    { path: '/bills/:id', name: 'billDetail', component: () => import('../views/bills/BillDetail.vue') },
    { path: '/payments/pending', name: 'pendingPayments', component: () => import('../views/payments/PendingPayments.vue') },
    { path: '/dashboard/vacancy', name: 'vacancy', component: () => import('../views/dashboard/Vacancy.vue') },
    { path: '/dashboard/expiring', name: 'expiring', component: () => import('../views/dashboard/Expiring.vue') },
    { path: '/dashboard/overdue', name: 'overdue', component: () => import('../views/dashboard/Overdue.vue') },
    { path: '/maintenance', name: 'maintenance', component: () => import('../views/Maintenance.vue') },
    { path: '/expenses', name: 'expenses', component: () => import('../views/Expenses.vue') },
    { path: '/reports', name: 'reports', component: () => import('../views/Reports.vue') },
    { path: '/mine', name: 'mine', component: () => import('../views/Mine.vue') },
    { path: '/settings', name: 'settings', component: () => import('../views/settings/Settings.vue') },
    { path: '/settings/landlords', name: 'landlords', component: () => import('../views/settings/Landlords.vue') },
    { path: '/settings/buildings', name: 'buildings', component: () => import('../views/settings/Buildings.vue') },
    { path: '/settings/room-types', name: 'roomTypes', component: () => import('../views/settings/RoomTypes.vue') },
  ],
});

// 路由守卫: 未登录跳转 login，保留 query 参数
router.beforeEach((to) => {
  const authStore = useAuthStore();
  if (to.path !== '/login' && !authStore.token) {
    return { path: '/login', query: to.query };
  }
});

export default router;
