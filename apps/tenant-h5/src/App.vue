<template>
  <router-view />
  <footer class="icp-footer">
    <a href="https://beian.miit.gov.cn" target="_blank" rel="noopener noreferrer">
      沪ICP备2026037197号
    </a>
  </footer>
</template>

<script setup lang="ts">
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

.icp-footer a {
  color: #969799;
  font-size: 12px;
  text-decoration: none;
  pointer-events: auto;
}
</style>
