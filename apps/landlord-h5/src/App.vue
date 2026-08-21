<template>
  <div class="app-content" :class="{ 'with-tabbar': showTabbar }">
    <router-view v-slot="{ Component }">
      <keep-alive :include="['RoomList']">
        <component :is="Component" />
      </keep-alive>
    </router-view>
  </div>
  <footer v-if="showIcpFooter" class="icp-footer" :class="{ 'with-tabbar': showTabbar }">
    <a href="https://beian.miit.gov.cn" target="_blank" rel="noopener noreferrer">
      沪ICP备2026037197号
    </a>
  </footer>
  <van-tabbar v-model="activeTab" v-if="showTabbar" route>
    <van-tabbar-item to="/" icon="home-o">工作台</van-tabbar-item>
    <van-tabbar-item to="/rooms" icon="shop-o">房间</van-tabbar-item>
    <van-tabbar-item to="/bills" icon="bill-o">账单</van-tabbar-item>
    <van-tabbar-item to="/mine" icon="user-o">我的</van-tabbar-item>
  </van-tabbar>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const activeTab = ref(0);

const showTabbar = computed(() => {
  const hiddenRoutes = ['/login'];
  return !hiddenRoutes.includes(route.path);
});

const showIcpFooter = computed(() => route.path === '/mine');
</script>

<style>
body {
  margin: 0;
  background: #f7f8fa;
}

.icp-footer {
  position: fixed;
  right: 0;
  bottom: 12px;
  left: 0;
  z-index: 9;
  text-align: center;
  pointer-events: none;
}

.icp-footer.with-tabbar {
  bottom: 58px;
}

.app-content.with-tabbar {
  padding-bottom: 60px;
  box-sizing: border-box;
}

.icp-footer a {
  color: #969799;
  font-size: 12px;
  text-decoration: none;
  pointer-events: auto;
}
</style>
