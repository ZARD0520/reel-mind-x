import * as path from 'path';
import { promises as fs } from 'fs';
import { VIDEO_REFERENCE_MAX_BYTES } from '@reel/contracts';

export async function validateReferenceImage(localPath: string): Promise<void> {
  const stat = await fs.stat(localPath);
  if (stat.size > VIDEO_REFERENCE_MAX_BYTES) throw new Error('视频参考图不能超过 5MB');
  const file = await fs.open(localPath, 'r');
  try {
    const header = Buffer.alloc(8);
    const { bytesRead } = await file.read(header, 0, 8, 0);
    const png = bytesRead === 8 && header.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = bytesRead >= 3 && header[0] === 255 && header[1] === 216 && header[2] === 255;
    if (!png && !jpeg) throw new Error('视频参考图仅支持 PNG、JPEG、JPG 格式');
  } finally { await file.close(); }
}

/** Library copies share the stored file URL but intentionally have no localPath. */
export function referenceImagePath(
  asset: { localPath: string | null; url: string | null },
  userId: string,
  storageDir: string,
): string | null {
  if (asset.localPath) return asset.localPath;
  const prefix = `/files/users/${userId}/uploads/`;
  if (!asset.url?.startsWith(prefix)) return null;
  const filename = asset.url.slice(prefix.length);
  // Only resolve files owned by this user; never fetch arbitrary URLs or accept traversal.
  if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(filename)) return null;
  return path.resolve(storageDir, 'users', userId, 'uploads', filename);
}
