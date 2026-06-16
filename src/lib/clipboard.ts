// src/lib/clipboard.ts
// 安全复制到剪贴板，兼容非 HTTPS 环境（fallback 到 execCommand）

export async function safeClipboardWrite(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (!ok) throw new Error('复制失败');
  }
}
