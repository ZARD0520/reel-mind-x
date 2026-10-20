// Explicit local bootstrap; no default administrator credentials or public role-changing endpoint.
const { PrismaClient } = require('../generated/client');
const prisma = new PrismaClient();
async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !email.includes('@')) throw new Error('用法: pnpm --filter @reel/db admin:grant <已注册邮箱>');
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error('请先在创作台注册该邮箱');
  await prisma.$transaction(async tx => {
    await tx.user.update({ where: { id: user.id }, data: { role: 'admin', status: 'active' } });
    await tx.adminAudit.create({ data: { actorId: 'local-bootstrap', action: 'admin.grant', targetId: user.id, detail: { email } } });
  });
  console.log(`已授予管理员权限: ${email}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
