<template>
  <div class="pay-bill-page">
    <van-nav-bar title="支付账单" left-arrow @click-left="$router.back()" />

    <van-loading v-if="loading" class="page-loading" />
    <template v-else>
      <van-empty v-if="!bill" description="账单不存在" />
      <template v-else>
        <van-cell-group inset title="账单信息">
          <van-cell title="应付金额" :value="`¥${bill.totalAmount}`" />
          <van-cell title="账单状态">
            <template #value>
              <van-tag :type="bill.status === 'PAID' ? 'success' : 'warning'">
                {{ bill.status === 'PAID' ? '已付款' : '待付款' }}
              </van-tag>
            </template>
          </van-cell>
        </van-cell-group>

        <template v-if="bill.status === 'PAID'">
          <div class="paid-state">
            <van-icon name="checked" size="56" color="#07c160" />
            <div>支付成功，账单已付款</div>
          </div>

          <van-cell-group inset title="费用明细">
            <van-cell
              v-for="item in bill.items"
              :key="item.id"
              :title="item.name"
              :value="`¥${item.amount}`"
            />
          </van-cell-group>

          <van-cell-group inset title="支付记录">
            <van-empty v-if="!confirmedPayments.length" description="暂无支付记录" />
            <van-cell
              v-for="payment in confirmedPayments"
              :key="payment.id"
              :title="channelLabel(payment.channel)"
              :value="`¥${payment.amount}`"
              :label="formatPaidAt(payment.paidAt)"
            />
          </van-cell-group>
        </template>

        <template v-else>
          <div class="payment-actions">
            <van-button
              block
              type="primary"
              :loading="creatingMethod === 'wechat'"
              :disabled="activeMethod !== null"
              @click="handleWechatPay"
            >
              微信支付
            </van-button>
          </div>

          <van-cell-group v-if="activeMethod" inset title="支付进度" class="payment-progress">
            <p v-if="paymentMode === 'mock'" class="mock-hint">模拟支付中...</p>
            <van-loading class="confirm-loading" size="22">等待支付确认...</van-loading>
            <van-button
              v-if="paymentMode === 'mock' && outTradeNo"
              block
              type="warning"
              plain
              :loading="simulating"
              :disabled="simulating"
              @click="simulateSuccess"
            >
              模拟支付成功（测试用）
            </van-button>
          </van-cell-group>
        </template>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { showToast } from 'vant';
import http from '../utils/http';

type PaymentMethod = 'wechat';
type PaymentMode = 'mock' | 'real';

interface BillItem {
  id: number;
  name: string;
  amount: string | number;
}

interface PaymentRecord {
  id: number;
  amount: string | number;
  paidAt: string;
  channel: string;
  status: string;
}

interface Bill {
  id: number;
  totalAmount: string | number;
  status: string;
  items: BillItem[];
  payments: PaymentRecord[];
}

interface WechatParams {
  appId: string;
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: string;
  paySign: string;
}

interface WechatOrderResponse {
  outTradeNo: string;
  mode: PaymentMode;
  wechatParams: WechatParams;
}

interface WeixinJSBridge {
  invoke(
    method: 'getBrandWCPayRequest',
    params: WechatParams,
    callback: (result: { err_msg?: string }) => void,
  ): void;
}

declare global {
  interface Document {
    WeixinJSBridge?: WeixinJSBridge;
  }

  interface Window {
    WeixinJSBridge?: WeixinJSBridge;
  }
}

const route = useRoute();
const bill = ref<Bill | null>(null);
const loading = ref(true);
const activeMethod = ref<PaymentMethod | null>(null);
const creatingMethod = ref<PaymentMethod | null>(null);
const paymentMode = ref<PaymentMode | null>(null);
const outTradeNo = ref('');
const simulating = ref(false);

const paymentChannelMap: Record<string, string> = {
  QRCODE: '收款码',
  WECHATPAY: '微信支付',
  ALIPAY: '支付宝',
  CASH: '现金',
  TRANSFER: '转账',
};

const confirmedPayments = computed(() =>
  bill.value?.payments?.filter((payment) => payment.status === 'CONFIRMED') ?? [],
);

function channelLabel(channel: string) {
  return paymentChannelMap[channel] || channel;
}

function formatPaidAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const POLL_INTERVAL = 3_000;
const MAX_POLL_COUNT = 20;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollCount = 0;
let bridgeReadyHandler: EventListener | null = null;

function findCurrentBill(leases: any[]): Bill | null {
  const billId = Number(route.params.id);
  for (const lease of leases) {
    const found = lease.bills?.find((item: Bill) => item.id === billId);
    if (found) return found;
  }
  return null;
}

async function refreshBill(): Promise<boolean> {
  const leases = await http.get('/tenant/bills') as any[];
  const currentBill = findCurrentBill(leases);
  if (currentBill) bill.value = currentBill;
  return currentBill?.status === 'PAID';
}

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function handlePaymentSuccess() {
  stopPolling();
  activeMethod.value = null;
  creatingMethod.value = null;
  paymentMode.value = null;
  outTradeNo.value = '';
  showToast('支付成功');
}

function startPolling() {
  stopPolling();
  pollCount = 0;

  const poll = async () => {
    if (!activeMethod.value || bill.value?.status === 'PAID') return;

    pollCount += 1;
    try {
      if (await refreshBill()) {
        handlePaymentSuccess();
        return;
      }
    } catch {
      // 请求错误已由 HTTP 拦截器提示，后续轮询仍继续。
    }

    if (pollCount >= MAX_POLL_COUNT) {
      activeMethod.value = null;
      paymentMode.value = null;
      outTradeNo.value = '';
      showToast('支付结果确认超时，请稍后查看账单');
      return;
    }
    pollTimer = setTimeout(poll, POLL_INTERVAL);
  };

  pollTimer = setTimeout(poll, POLL_INTERVAL);
}

function invokeWechatPay(params: WechatParams) {
  const invoke = () => {
    const bridge = document.WeixinJSBridge ?? window.WeixinJSBridge;
    if (!bridge) {
      showToast('当前环境无法拉起微信支付');
      return;
    }
    bridge.invoke('getBrandWCPayRequest', {
      appId: params.appId,
      timeStamp: params.timeStamp,
      nonceStr: params.nonceStr,
      package: params.package,
      signType: params.signType,
      paySign: params.paySign,
    }, (result) => {
      if (result.err_msg === 'get_brand_wcpay_request:cancel') {
        showToast('已取消微信支付');
      } else if (result.err_msg && result.err_msg !== 'get_brand_wcpay_request:ok') {
        showToast('微信支付未完成，请重试');
      }
    });
  };

  if (document.WeixinJSBridge ?? window.WeixinJSBridge) {
    invoke();
    return;
  }

  bridgeReadyHandler = invoke;
  document.addEventListener('WeixinJSBridgeReady', bridgeReadyHandler, { once: true });
}

async function handleWechatPay() {
  if (!bill.value || activeMethod.value) return;

  activeMethod.value = 'wechat';
  creatingMethod.value = 'wechat';
  try {
    const response = await http.post('/payments/wechat/create-order', {
      billId: bill.value.id,
    }) as WechatOrderResponse;
    outTradeNo.value = response.outTradeNo;
    paymentMode.value = response.mode;
    startPolling();

    if (response.mode === 'real') invokeWechatPay(response.wechatParams);
  } catch {
    activeMethod.value = null;
  } finally {
    creatingMethod.value = null;
  }
}

async function simulateSuccess() {
  if (!outTradeNo.value || paymentMode.value !== 'mock' || simulating.value) return;

  simulating.value = true;
  try {
    await http.post('/payments/mock/simulate-success', {
      outTradeNo: outTradeNo.value,
    });
    if (await refreshBill()) handlePaymentSuccess();
  } finally {
    simulating.value = false;
  }
}

onMounted(async () => {
  try {
    await refreshBill();
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  stopPolling();
  if (bridgeReadyHandler) {
    document.removeEventListener('WeixinJSBridgeReady', bridgeReadyHandler);
  }
});
</script>

<style scoped>
.pay-bill-page { padding-bottom: 24px; }
.page-loading { display: flex; justify-content: center; padding: 60px; }
.payment-actions { display: grid; gap: 12px; padding: 20px 16px; }
.payment-progress { padding: 16px; }
.paid-state { display: grid; justify-items: center; gap: 12px; padding: 48px 16px; color: #07c160; }
.mock-hint { margin: 0 0 12px; text-align: center; color: #ed6a0c; }
.confirm-loading { display: flex; justify-content: center; margin-bottom: 20px; }
</style>
