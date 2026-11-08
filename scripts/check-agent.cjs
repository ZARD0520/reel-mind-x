const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const flags = new Set(process.argv.slice(2));
for (const flag of flags) if (!['--full', '--live'].includes(flag)) throw new Error(`未知选项：${flag}`);
if (flags.has('--live') && !flags.has('--full')) throw new Error('--live 需要同时传入 --full');
const env = { ...process.env, LIVE_AGENT_SMOKE: '0', AGENT_DATABASE_TESTS: '0' };
let checks = 0;
function run(label, executable, args, extra = {}) {
  process.stdout.write(`\n[Agent 检查] ${label}\n`);
  const result = spawnSync(executable, args, { cwd: root, env: { ...env, ...extra }, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  checks++;
}
const pnpm = (...args) => run(args.join(' '), 'pnpm', args);
pnpm('--filter', '@reel/contracts', 'build');
pnpm('--filter', '@reel/contracts', 'test');
pnpm('--filter', '@reel/web', 'test');
pnpm('--filter', '@reel/api', 'test');
if (flags.has('--full')) {
  run('隔离数据库：计划、租约、回执、恢复、积分', process.execPath,
    ['--env-file=apps/api/.env', '--test', 'apps/api/test/canvas-agent-plan.test.cjs'], { AGENT_DATABASE_TESTS: '1' });
  run('生成任务可靠性', process.execPath, ['--test', 'apps/api/test/generation-reliability.test.cjs']);
  pnpm('--filter', '@reel/api', 'build');
  pnpm('--filter', '@reel/web', 'build');
  pnpm('--filter', '@reel/admin', 'build');
  const browserEnv = { E2E_BASE_URL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173' };
  for (const file of ['canvas-agent', 'canvas-agent-recovery', 'canvas-agent-resume', 'canvas-save-races', 'canvas-history', 'canvas-prompt-drafts', 'canvas-chat-mentions', 'canvas-batch-failures']) {
    run(`浏览器：${file}`, process.execPath, [`apps/web/test/${file}.browser.cjs`], { ...browserEnv, E2E_INSECURE_HTTP: file === 'canvas-agent' ? '1' : '0' });
  }
  if (flags.has('--live')) run('真实 Planner；图片提供商仍使用模拟', process.execPath,
    ['--env-file=apps/api/.env', '--test', '--test-name-pattern=live phase two', 'apps/api/test/canvas-agent-plan.test.cjs'], { LIVE_AGENT_SMOKE: '1' });
}
process.stdout.write(`\nAgent 检查完成：${checks} 个检查组通过。${flags.has('--full') ? '' : '数据库与浏览器验收请使用 --full。'}\n`);
