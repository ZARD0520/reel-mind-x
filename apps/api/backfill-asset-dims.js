/* 一次性回填：为缺失 width/height 的存量素材探测尺寸（storage 本地文件）。
 * 用法: DATABASE_URL=... node backfill-asset-dims.js  （在 apps/api 目录下执行） */
const { execFile } = require('child_process');
const path = require('path');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const { PrismaClient } = require('@reel/db');

const prisma = new PrismaClient();

function probe(filePath) {
  return new Promise((resolve) => {
    execFile(
      ffprobeInstaller.path,
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,duration', '-of', 'json', filePath],
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          const stream = JSON.parse(stdout).streams?.[0];
          if (!stream) return resolve(null);
          resolve({
            width: stream.width ?? null,
            height: stream.height ?? null,
            duration: stream.duration ? Number(stream.duration) : null,
          });
        } catch {
          resolve(null);
        }
      },
    );
  });
}

function localPathFromUrl(url, userId) {
  if (!url) return null;
  const marker = `/files/users/${userId}/uploads/`;
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  return path.resolve('storage', 'users', userId, 'uploads', url.slice(idx + marker.length).split('?')[0]);
}

async function main() {
  await prisma.$connect();
  const assets = await prisma.asset.findMany({
    where: { kind: { in: ['image', 'video'] }, width: null },
    select: { id: true, userId: true, kind: true, url: true, localPath: true },
  });
  console.log(`待回填素材: ${assets.length}`);
  let updated = 0;
  for (const asset of assets) {
    const filePath = asset.localPath || localPathFromUrl(asset.url, asset.userId);
    if (!filePath) continue;
    const info = await probe(filePath);
    if (!info || !info.width || !info.height) {
      console.log(`跳过(探测失败): ${asset.id}`);
      continue;
    }
    await prisma.asset.update({
      where: { id: asset.id },
      data: {
        width: info.width,
        height: info.height,
        ...(asset.kind === 'video' && info.duration
          ? { durationInFrames: Math.round(info.duration * 30) }
          : {}),
      },
    });
    updated += 1;
  }
  console.log(`已回填: ${updated}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
