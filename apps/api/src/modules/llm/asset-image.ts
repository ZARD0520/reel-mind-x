import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
import { promises as fs } from 'fs';
import path from 'path';

/** 单次请求最多携带的参考图数量 */
export const MAX_REFERENCE_IMAGES = 4;
/** 无需压缩、直接以 base64 传输的大小上限 */
const DIRECT_MAX_BYTES = 3 * 1024 * 1024;
/** 压缩后允许的大小上限（超过则放弃该图） */
const CONVERTED_MAX_BYTES = 5 * 1024 * 1024;

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic;

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('ffmpeg 不可用'));
      return;
    }
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.slice(0, 300) || `ffmpeg exited ${code}`))));
  });
}

/** 把图片压缩为最长边 ≤2048px 的 JPEG（结果缓存在原文件旁），失败返回 null */
async function downscaleToJpeg(filePath: string): Promise<Buffer | null> {
  const cachePath = `${filePath}.chat.jpg`;
  try {
    const cached = await fs.stat(cachePath).catch(() => null);
    if (cached?.isFile()) return await fs.readFile(cachePath);
    await runFfmpeg([
      '-y', '-v', 'error', '-i', filePath,
      '-vf', "scale='min(2048,iw)':-2", '-q:v', '4', cachePath,
    ]);
    const converted = await fs.readFile(cachePath);
    if (converted.byteLength > CONVERTED_MAX_BYTES) return null;
    return converted;
  } catch (error) {
    console.warn(`[Llm] 参考图压缩失败，已跳过：${(error as Error).message}`);
    await fs.unlink(cachePath).catch(() => undefined);
    return null;
  }
}

/**
 * 读取 /files/users/{userId}/{scope}/{filename} 对应的本地文件，转为视觉模型可用的 base64 data URL。
 * 小图直接内联；大图或非常规编码（如 heic）先用 ffmpeg 压缩为 JPEG（结果缓存）。
 * 视觉模型由智谱服务端拉取 URL，无法携带本站登录态，因此必须以 base64 内联。
 * 非本站路径或处理失败返回 null（调用方跳过该图即可）。
 */
export async function readLocalImageAsDataUrl(storageDir: string, url: string): Promise<string | null> {
  try {
    if (!url.startsWith('/files/')) return null;
    const [, , , userId, scope, filename] = url.split('/');
    if (!userId || !scope || !filename || filename !== path.basename(filename)) return null;
    const filePath = path.resolve(storageDir, 'users', userId, scope, filename);
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    const directMime = IMAGE_MIME_BY_EXT[path.extname(filename).toLowerCase()];
    if (directMime && stat.size <= DIRECT_MAX_BYTES) {
      const buffer = await fs.readFile(filePath);
      return `data:${directMime};base64,${buffer.toString('base64')}`;
    }
    const converted = await downscaleToJpeg(filePath);
    if (!converted) return null;
    return `data:image/jpeg;base64,${converted.toString('base64')}`;
  } catch (error) {
    console.warn(`[Llm] 读取参考图失败，已跳过：${(error as Error).message}`);
    return null;
  }
}
