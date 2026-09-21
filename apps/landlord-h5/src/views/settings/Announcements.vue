<template>
  <div>
    <van-nav-bar title="群发通知" left-arrow @click-left="$router.back()" />
    <van-cell-group inset title="发送新通知">
      <van-field v-model="form.title" label="标题" placeholder="例如:台风预警" />
      <van-field v-model="form.content" label="内容" type="textarea" rows="3" autosize placeholder="例如:明天有台风,请注意出行安全" />
      <van-field
        readonly
        is-link
        label="发送范围"
        :model-value="scopeText"
        @click="showScopePicker = true"
      />
      <van-notice-bar
        left-icon="info-o"
        text="走微信客服消息通道,只有近48小时内跟公众号有过互动的租客才能收到,不是100%必达,发送后会显示实际成功/失败数量。"
        wrapable
      />
      <van-button type="primary" block style="margin:12px 16px 0;width:calc(100% - 32px)" :loading="sending" @click="handleSend">
        发送
      </van-button>
    </van-cell-group>

    <van-cell-group inset title="发送历史" style="margin-top:12px">
      <van-loading v-if="loading" class="page-loading" />
      <van-empty v-else-if="history.length === 0" description="暂无发送记录" />
      <van-cell
        v-else
        v-for="a in history"
        :key="a.id"
        :title="a.title"
        :label="`${a.content} · ${a.property?.name || '全部公寓'} · ${a.createdAt?.split('T')[0]}`"
      >
        <template #value>
          <span class="stat-success">成功{{ a.successCount }}</span> /
          <span class="stat-fail">失败{{ a.failCount }}</span>
        </template>
      </van-cell>
    </van-cell-group>

    <van-popup v-model:show="showScopePicker" position="bottom">
      <van-picker :columns="scopeColumns" @confirm="onScopeConfirm" @cancel="showScopePicker = false" />
    </van-popup>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { showToast, showConfirmDialog } from 'vant';
import http from '../../utils/http';
import { usePropertyStore } from '../../stores/property';

const propertyStore = usePropertyStore();
const form = reactive({ title: '', content: '', propertyId: undefined as number | undefined });
const sending = ref(false);
const loading = ref(true);
const history = ref<any[]>([]);
const showScopePicker = ref(false);

const scopeColumns = computed(() => [
  { text: '全部公寓', value: undefined },
  ...propertyStore.properties.map((p: any) => ({ text: p.name, value: p.id })),
]);
const scopeText = computed(
  () => propertyStore.properties.find((p: any) => p.id === form.propertyId)?.name || '全部公寓',
);

function onScopeConfirm({ selectedOptions }: any) {
  form.propertyId = selectedOptions[0].value;
  showScopePicker.value = false;
}

async function fetchHistory() {
  loading.value = true;
  try {
    history.value = (await http.get('/announcements')) as any;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if (propertyStore.properties.length === 0) propertyStore.fetchProperties();
  fetchHistory();
});

async function handleSend() {
  if (!form.title.trim() || !form.content.trim()) {
    showToast('请填写标题和内容');
    return;
  }
  await showConfirmDialog({
    title: '确认发送',
    message: `即将把这条通知发送给${scopeText.value}的全部在租租客,确定吗?`,
  });
  sending.value = true;
  try {
    const result = (await http.post('/announcements', {
      title: form.title,
      content: form.content,
      propertyId: form.propertyId,
    })) as any;
    showToast(`发送完成:成功${result.successCount},失败${result.failCount}`);
    form.title = '';
    form.content = '';
    fetchHistory();
  } finally {
    sending.value = false;
  }
}
</script>

<style scoped>
.page-loading { display: flex; justify-content: center; padding: 40px; }
.stat-success { color: #07c160; }
.stat-fail { color: #ee0a24; }
</style>
