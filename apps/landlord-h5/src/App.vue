<template>
  <div v-if="showTabbar" class="property-switcher" @click="showActionSheet = true">
    <span>当前:{{ propertyLabel }}</span>
    <van-icon name="arrow-down" />
  </div>
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
  <van-action-sheet
    v-model:show="showActionSheet"
    :actions="propertyActions"
    cancel-text="取消"
    @select="onSelectProperty"
  />
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { usePropertyStore } from './stores/property';

const route = useRoute();
const propertyStore = usePropertyStore();
const activeTab = ref(0);
const showActionSheet = ref(false);

const showTabbar = computed(() => {
  const hiddenRoutes = ['/login'];
  return !hiddenRoutes.includes(route.path);
});

const showIcpFooter = computed(() => route.path === '/mine');

const propertyLabel = computed(() => {
  if (propertyStore.currentPropertyId === null) {
    return '全部公寓';
  }
  return propertyStore.properties.find((property) => property.id === propertyStore.currentPropertyId)?.name
    || '全部公寓';
});

const propertyActions = computed(() => [
  { name: '全部公寓' },
  ...propertyStore.properties.map((property) => ({ name: property.name })),
]);

function onSelectProperty(_: any, index: number) {
  if (index === 0) {
    propertyStore.setCurrentProperty(null);
  } else {
    propertyStore.setCurrentProperty(propertyStore.properties[index - 1].id);
  }
  showActionSheet.value = false;
}

onMounted(() => {
  propertyStore.fetchProperties();
});
</script>

<style>
body {
  margin: 0;
  background: #f7f8fa;
}

.property-switcher {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  color: #323233;
  font-size: 14px;
  background: #fff;
  border-bottom: 1px solid #ebedf0;
  box-sizing: border-box;
  cursor: pointer;
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
