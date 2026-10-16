import type { Asset } from '@reel/contracts';

export async function downloadAssetFile(asset: Asset): Promise<void> {
  let blob: Blob;
  let extension = '.txt';
  if (asset.kind === 'text') {
    blob = new Blob([asset.content ?? ''], { type: 'text/plain;charset=utf-8' });
  } else {
    if (!asset.url) throw new Error('素材文件暂不可用');
    const response = await fetch(asset.url, { credentials: 'include' });
    if (!response.ok) throw new Error('下载失败，请重试');
    blob = await response.blob();
    const pathname = new URL(asset.url, window.location.origin).pathname;
    extension = pathname.match(/\.[a-zA-Z0-9]+$/)?.[0] ?? ({ image: '.png', video: '.mp4', audio: '.mp3' }[asset.kind]);
  }
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = /\.[a-zA-Z0-9]+$/.test(asset.name) ? asset.name : `${asset.name}${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
