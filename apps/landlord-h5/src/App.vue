<template>
  <router-view />
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
</script>

<style>
body {
  margin: 0;
  background: #f7f8fa;
}
</style>
