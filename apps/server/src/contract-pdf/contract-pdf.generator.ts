import { existsSync } from 'fs';
import puppeteer from 'puppeteer-core';
import { buildContractHtml } from './contract-pdf.template';
import { ContractPdfData } from './contract-pdf.types';
import { numberToChineseUppercase } from './number-to-chinese-uppercase';

/**
 * puppeteer-core 不自带下载浏览器,需要指向系统已安装的 Chrome/Chromium。
 * 优先读 PDF_CHROME_EXECUTABLE_PATH 环境变量(生产服务器必须显式配置,
 * 通常是 `apt install chromium-browser` 后的 `/usr/bin/chromium-browser`);
 * 未配置时按平台猜测常见安装路径,方便本地开发免配置直接用。
 */
function resolveChromeExecutablePath(): string {
  const configured = process.env.PDF_CHROME_EXECUTABLE_PATH;
  if (configured) {
    if (!existsSync(configured)) {
      throw new Error(
        `PDF_CHROME_EXECUTABLE_PATH 指向的路径不存在: ${configured}`,
      );
    }
    return configured;
  }

  const candidates =
    process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ]
      : [
          '/usr/bin/chromium-browser',
          '/usr/bin/chromium',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/google-chrome',
        ];

  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error(
      '找不到可用的 Chrome/Chromium 可执行文件,请设置 PDF_CHROME_EXECUTABLE_PATH 环境变量指向系统已安装的浏览器' +
        '(生产服务器需先 `sudo apt install chromium-browser` 或等价包)。',
    );
  }
  return found;
}

export async function renderContractHtmlToPdf(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: resolveChromeExecutablePath(),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(async () => document.fonts.ready);
    const bytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    return Buffer.from(bytes);
  } finally {
    await browser.close();
  }
}

/** 独立入口：把合同数据组装为固定版式 HTML 并生成真实 PDF 字节。 */
export async function generateContractPdf(data: ContractPdfData): Promise<Buffer> {
  const html = buildContractHtml(
    data,
    numberToChineseUppercase(data.monthlyRent),
  );
  return renderContractHtmlToPdf(html);
}
