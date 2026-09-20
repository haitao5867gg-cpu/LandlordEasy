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
