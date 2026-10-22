import * as path from 'path';

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
