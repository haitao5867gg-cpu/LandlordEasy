import http from './http';

/** Fetch with Authorization header; never place credentials in a URL. */
export async function downloadContract(taskId: number): Promise<void> {
  const blob = await http.get(`/tenant/contracts/${taskId}/pdf`, {
    responseType: 'blob',
    timeout: 60000,
  }) as unknown as Blob;
  if (!(blob instanceof Blob) || !blob.type.toLowerCase().startsWith('application/pdf')) {
    throw new Error('合同文件暂不可用，请稍后重试');
  }
  // 安卓微信内置浏览器对<a download>+blob的保存基本不可用(2026-09-22
  // GasCan父亲安卓机实测:点"下载合同"无反应);微信内一律改为直接打开
  // blob URL预览,用户长按/右上角菜单可另存。非微信浏览器保留下载行为。
  if (/MicroMessenger/i.test(navigator.userAgent)) {
    const previewUrl = URL.createObjectURL(blob);
    const win = window.open(previewUrl, '_blank');
    if (!win) window.location.href = previewUrl;
    window.setTimeout(() => URL.revokeObjectURL(previewUrl), 60000);
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `contract-${taskId}-signed.pdf`;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Keep the blob alive while the browser starts its download (including mobile).
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
