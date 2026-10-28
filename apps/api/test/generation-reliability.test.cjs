/* Real PostgreSQL, isolated schema, fake providers: no paid generation calls. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const apiRequire = createRequire(path.resolve(__dirname, '../package.json'));
const ts = apiRequire('typescript');
apiRequire('reflect-metadata');
require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
      },
      fileName: filename,
    }).outputText,
    filename,
  );
const { PrismaClient } = apiRequire('@reel/db');
const { AiGenError } = apiRequire('@reel/ai-gen');
const {
  GenerationTasksService,
} = require('../src/modules/generation-tasks/generation-tasks.service.ts');
const {
  GenerationTasksProcessor,
} = require('../src/modules/generation-tasks/generation-tasks.processor.ts');
const {
  generationFeedbackMessage,
  generationTasksPollingInterval,
  recoverGenerationTasks,
} = require('../../web/src/features/canvas/generation-recovery.ts');
const { AssetsService } = require('../src/modules/assets/assets.service.ts');
const { CreditsService } = require('../src/modules/credits/credits.service.ts');
const { AdminService } = require('../src/modules/admin/admin.service.ts');
const { AdminGuard } = require('../src/modules/admin/admin.guard.ts');
const { AdminController } = require('../src/modules/admin/admin.controller.ts');
const { CreditsController } = require('../src/modules/credits/credits.controller.ts');
const { AuthController } = require('../src/modules/auth/auth.controller.ts');
const { AuthService } = require('../src/modules/auth/auth.service.ts');
const { AuthGuard } = require('../src/modules/auth/auth.guard.ts');
const { ZodExceptionFilter } = require('../src/filters/zod-exception.filter.ts');
const { CanvasChatService } = require('../src/modules/canvas-chat/canvas-chat.service.ts');
const { CanvasesService } = require('../src/modules/canvases/canvases.service.ts');
const { PrismaService } = require('../src/prisma/prisma.service.ts');
const { AssetFoldersService } = require('../src/modules/asset-folders/asset-folders.service.ts');
const repo = path.resolve(__dirname, '../../..');
const { referenceImagePath } = require('../src/modules/generation-tasks/reference-image-path.ts');

test('media model contracts reject unsupported options and preserve valid parameters', () => {
  const { CreateGenerationTaskSchema, VIDEO_SIZES, IMAGE_SIZES } = apiRequire('@reel/contracts');
  const base = { requestId: randomUUID(), canvasId: randomUUID(), kind: 'video', prompt: 'test' };
  for (const size of VIDEO_SIZES) for (const fps of [30, 60]) {
    const result = CreateGenerationTaskSchema.parse({ ...base, size, fps, quality: 'quality' });
    assert.equal(result.size, size);
    assert.equal(result.fps, fps);
  }
  for (const patch of [{ size: '1280x720' }, { fps: 24 }, { duration: 10 }, { prompt: 'a'.repeat(513) }, { imageAssetIds: [randomUUID(), randomUUID()] }, { quality: 'hd' }]) {
    assert.equal(CreateGenerationTaskSchema.safeParse({ ...base, ...patch }).success, false);
  }
  assert.equal(CreateGenerationTaskSchema.safeParse({ ...base, prompt: 'a'.repeat(512) }).success, true);
  for (const size of IMAGE_SIZES) assert.equal(CreateGenerationTaskSchema.safeParse({ ...base, kind: 'image', size }).success, true);
  for (const patch of [{ size: '2048x2048' }, { size: '513x512' }, { prompt: 'a'.repeat(2001) }, { quality: 'speed' }]) {
    assert.equal(CreateGenerationTaskSchema.safeParse({ ...base, kind: 'image', ...patch }).success, false);
  }
});

test('provider forwards resolution, frame rate, quality and audio without Flash duration', async () => {
  const { ZhipuAiGenProvider } = apiRequire('@reel/ai-gen');
  const provider = new ZhipuAiGenProvider({ apiKey: 'fixture' });
  const originalFetch = global.fetch;
  const bodies = [];
  global.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ id: 'fixture', data: [{ url: 'https://fixture/image.png' }] }) };
  };
  try {
    await provider.submitVideo({ prompt: 'test', model: 'cogvideox-flash', size: '3840x2160', fps: 60, quality: 'quality', withAudio: true, duration: 10, imageUrls: ['data:image/png;base64,fixture'] });
    assert.deepEqual(bodies[0], { model: 'cogvideox-flash', prompt: 'test', size: '3840x2160', fps: 60, quality: 'quality', with_audio: true, image_url: 'data:image/png;base64,fixture' });
    await provider.generateImage({ prompt: 'test', size: '864x1152', quality: 'hd' });
    assert.equal(bodies[1].quality, 'hd');
    assert.equal(bodies[1].size, '864x1152');
  } finally { global.fetch = originalFetch; }
});

test('library reference paths resolve only user-owned stored uploads', () => {
  assert.equal(referenceImagePath({ localPath: null, url: '/files/users/owner/uploads/image.png' }, 'owner', '/storage'), '/storage/users/owner/uploads/image.png');
  for (const url of ['/files/users/other/uploads/image.png', '/files/users/owner/uploads/../secret.png', '/files/users/owner/uploads/%2e%2e%2fsecret.png', 'https://invalid.test/image.png']) {
    assert.equal(referenceImagePath({ localPath: null, url }, 'owner', '/storage'), null);
  }
});
const {
  acceptsDependency,
  acceptsDependencyInput,
} = require('../../web/src/features/canvas/dependency-rules.ts');

test('audio dependencies accept text input and feed video, including uploaded audio', () => {
  assert.equal(acceptsDependency('text', 'audio'), true);
  assert.equal(acceptsDependency('audio', 'video'), true);
  for (const source of ['image', 'video', 'audio'])
    assert.equal(acceptsDependency(source, 'audio'), false);
  for (const target of ['text', 'image']) assert.equal(acceptsDependency('audio', target), false);
  assert.equal(acceptsDependencyInput({ kind: 'audio', uploaded: true }), false);
  assert.equal(acceptsDependencyInput({ kind: 'audio' }), true);
  for (const kind of ['image', 'video'])
    assert.equal(acceptsDependencyInput({ kind, uploaded: true }), false);
  for (const source of ['text', 'image']) assert.equal(acceptsDependency(source, 'video'), true);
});

test('canvas polling only follows runnable tasks, not terminal or paused tasks', () => {
  assert.equal(generationTasksPollingInterval(), false);
  assert.equal(generationTasksPollingInterval([]), false);
  for (const status of ['failed', 'completed', 'unknown'])
    assert.equal(generationTasksPollingInterval([{ status }]), false);
  for (const status of ['queued', 'submitting', 'generating', 'saving'])
    assert.equal(generationTasksPollingInterval([{ status }]), 3000);
  assert.equal(
    generationTasksPollingInterval([{ status: 'failed' }, { status: 'completed' }]),
    false,
  );
  assert.equal(
    generationTasksPollingInterval([{ status: 'failed' }, { status: 'generating' }]),
    3000,
  );
});

test('historical failures are silent on entry while failures observed during the visit remain visible', () => {
  const nodes = [
    {
      id: 'node',
      position: { x: 0, y: 0 },
      data: {
        kind: 'video',
        title: '视频',
        content: '',
        status: 'generating',
        generationFailureVisible: false,
      },
    },
  ];
  const failed = {
    id: 'task',
    requestId: 'request',
    nodeId: 'node',
    status: 'failed',
    error: '模型繁忙',
    canResume: false,
    items: [],
    model: 'model',
  };
  const historical = recoverGenerationTasks(nodes, [], [failed], () => 400);
  assert.equal(historical.nodes[0].data.status, 'failed');
  assert.equal(generationFeedbackMessage(historical.nodes[0].data), '');
  const running = recoverGenerationTasks(
    nodes,
    [],
    [{ ...failed, status: 'generating', error: null }],
    () => 400,
  );
  assert.equal(running.nodes[0].data.generationFailureVisible, true);
  const liveFailure = recoverGenerationTasks(running.nodes, [], [failed], () => 400);
  assert.equal(generationFeedbackMessage(liveFailure.nodes[0].data), '模型繁忙');
});

test('a failed batch sibling never shows retry-save while other images are still running', () => {
  const nodes = [
    {
      id: 'batch-node',
      position: { x: 0, y: 0 },
      data: {
        kind: 'image',
        title: '图片',
        content: '',
        generationFailureVisible: true,
      },
    },
  ];
  const task = {
    id: 'batch-task',
    nodeId: 'batch-node',
    requestId: 'batch-request',
    status: 'saving',
    error: '素材已生成，正在重试保存',
    canResume: true,
    model: 'model',
    items: [{ status: 'failed' }, { status: 'saving' }],
  };
  const running = recoverGenerationTasks(nodes, [], [task], () => 400);
  assert.equal(running.nodes[0].data.generationCanResume, false);
  assert.equal(generationFeedbackMessage(running.nodes[0].data), '');
  const failed = recoverGenerationTasks(
    running.nodes,
    [],
    [{ ...task, status: 'failed' }],
    () => 400,
  );
  assert.equal(failed.nodes[0].data.generationCanResume, true);
});

test('mixed and all-failed batches retain all outputs; deleted nodes stay deleted after recovery', () => {
  const nodes = [
    {
      id: 'parent',
      type: 'workflow',
      position: { x: 0, y: 0 },
      data: {
        kind: 'image',
        title: '图片',
        content: '',
        prompt: '测试提示词',
        generationFailureVisible: true,
        referenceNodeIds: ['upstream'],
      },
    },
  ];
  const edges = [{ id: 'dependency', source: 'upstream', target: 'parent' }];
  const task = {
    id: 'batch',
    requestId: 'request',
    nodeId: 'parent',
    model: 'model',
    status: 'failed',
    error: '模型繁忙',
    canResume: false,
    items: Array.from({ length: 4 }, (_, index) => ({
      id: `item-${index}`,
      index,
      status: index % 2 ? 'completed' : 'failed',
      error: index % 2 ? null : '模型繁忙',
      asset: { id: `asset-${index}`, url: index % 2 ? `/image-${index}.png` : null },
    })),
  };
  const recovered = recoverGenerationTasks(nodes, edges, [task], () => 400);
  assert.equal(recovered.nodes.length, 4);
  assert.equal(recovered.nodes.filter((node) => node.data.status === 'ready').length, 2);
  assert.equal(recovered.nodes.filter((node) => node.data.status === 'failed').length, 2);
  assert.equal(recovered.nodes[0].data.error, '');
  assert.equal(recovered.edges.length, 4);
  const removedId = 'asset-2';
  const remaining = recovered.nodes.filter((node) => node.id !== removedId);
  const again = recoverGenerationTasks(remaining, recovered.edges, [task], () => 400);
  assert.equal(again.nodes, remaining);
  const reentered = recoverGenerationTasks(
    remaining.map((node) => ({
      ...node,
      data: {
        ...node.data,
        generationRequestId: undefined,
        generationFailureVisible: false,
      },
    })),
    recovered.edges,
    [task],
    () => 400,
  );
  assert.equal(reentered.nodes.length, 3);
  assert.ok(reentered.nodes.every((node) => generationFeedbackMessage(node.data) === ''));

  const allFailed = recoverGenerationTasks(
    nodes,
    edges,
    [
      {
        ...task,
        items: task.items.map((item) => ({ ...item, status: 'failed', error: '模型繁忙' })),
      },
    ],
    () => 400,
  );
  assert.equal(allFailed.nodes.length, 4);
  assert.ok(allFailed.nodes.every((node) => node.data.status === 'failed' && !node.data.url));

  // Backfill an already-applied old graph, without recreating a deleted successful output.
  const old = [
    {
      ...recovered.nodes[0],
      data: {
        ...recovered.nodes[0].data,
        generationBatchResultsTaskId: undefined,
        content: '保留用户编辑',
      },
    },
  ];
  const migrated = recoverGenerationTasks(old, edges, [task], () => 400);
  assert.equal(migrated.nodes.length, 3);
  assert.equal(migrated.nodes[0].data.content, '保留用户编辑');
  assert.equal(migrated.nodes.filter((node) => node.data.status === 'failed').length, 2);

  // Resuming failed saves updates the matching output instead of adding duplicate successful nodes.
  const resumed = recoverGenerationTasks(
    recovered.nodes,
    recovered.edges,
    [{ ...task, status: 'saving' }],
    () => 400,
  );
  const finished = recoverGenerationTasks(
    resumed.nodes,
    resumed.edges,
    [
      {
        ...task,
        status: 'completed',
        error: null,
        items: task.items.map((item) => ({
          ...item,
          status: 'completed',
          error: null,
          asset: { ...item.asset, url: `/saved-${item.index}.png` },
        })),
      },
    ],
    () => 400,
  );
  assert.equal(finished.nodes.length, 4);
  assert.ok(finished.nodes.every((node) => node.data.status === 'ready'));
  assert.equal(new Set(finished.nodes.map((node) => node.data.assetId)).size, 4);
});

test('imported node media is not overwritten by older generation tasks', () => {
  const nodes = [
    {
      id: 'node',
      position: { x: 0, y: 0 },
      data: {
        kind: 'image',
        title: 'Imported',
        content: '',
        assetId: 'uploaded',
        url: '/uploaded.png',
        status: 'ready',
        generationDetached: true,
      },
    },
  ];
  const result = recoverGenerationTasks(
    nodes,
    [],
    [{ nodeId: 'node', requestId: 'old-request' }],
    () => 400,
  );
  assert.equal(result.nodes, nodes);
  assert.equal(result.nodes[0].data.assetId, 'uploaded');
});

test(
  'durable generation reliability (isolated local database)',
  { timeout: 120000 },
  async (suite) => {
    const envFile = fs.readFileSync(path.join(repo, 'packages/db/.env'), 'utf8');
    const databaseUrl =
      process.env.TEST_DATABASE_URL ?? envFile.match(/^DATABASE_URL=["']?([^\r\n"']+)/m)?.[1];
    assert.ok(databaseUrl, 'Set TEST_DATABASE_URL to a local PostgreSQL database');
    const url = new URL(databaseUrl);
    assert.ok(
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
      'Tests only run against a local database',
    );
    const schema = `generation_test_${randomUUID().replaceAll('-', '')}`;
    url.searchParams.set('schema', schema);
    const prisma = new PrismaClient({ datasourceUrl: url.toString() });
    const storage = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'reel-generation-test-'));
    const config = {
      get: (key) =>
        ({
          GLM_API_KEY: 'fake-provider-key',
          GLM_BASE_URL: 'https://invalid.test',
          GLM_MODEL: 'glm-4-flash',
          GLM_IMAGE_MODEL: 'cogview-3-flash',
          GLM_VIDEO_MODEL: 'cogvideox-flash',
          SESSION_SECRET: 'isolated-test-session-secret',
          AUTH_COOKIE_NAME: 'test_session',
          AUTH_SESSION_DAYS: 1,
          STORAGE_DIR: storage,
        })[key],
    };
    let service;
    const credits = new CreditsService(prisma, config);
    const admin = new AdminService(prisma, credits);
    let user;
    let canvas;
    const enqueued = [];
    const queue = {
      add: async (name, data, options) => {
        enqueued.push({ name, data, options });
      },
      setGlobalConcurrency: async () => {},
    };
    const freshWorker = (
      provider = {},
      text = { generateContent: async () => ({ text: '测试结果', model: 'glm-4-flash' }) },
    ) => {
      const worker = new GenerationTasksProcessor(prisma, service, config, text);
      // Any unmocked network call fails immediately rather than reaching a real service.
      worker.provider = new Proxy(provider, {
        get: (target, key) =>
          target[key] ??
          (() => {
            throw new Error(`Unexpected provider call: ${String(key)}`);
          }),
      });
      worker.saveMedia = async (id) => ({
        url: `/files/test/${id}.mp4`,
        localPath: `/private/tmp/${id}.mp4`,
        width: 1280,
        height: 720,
        durationInFrames: 150,
      });
      return worker;
    };
    const create = (overrides = {}) =>
      service.create(user.id, {
        requestId: randomUUID(),
        canvasId: canvas.id,
        nodeId: randomUUID(),
        kind: 'video',
        prompt: '测试视频',
        ...overrides,
      });
    const step = async (worker, itemId) => {
      await prisma.generationTaskItem.update({
        where: { id: itemId },
        data: { nextRunAt: new Date(0) },
      });
      const item = await prisma.generationTaskItem.findUniqueOrThrow({ where: { id: itemId } });
      await worker.process({ data: { id: item.id, revision: item.revision } });
      return prisma.generationTaskItem.findUniqueOrThrow({ where: { id: itemId } });
    };
    try {
      const prismaPackage = createRequire(path.join(repo, 'packages/db/package.json')).resolve(
        'prisma/package.json',
      );
      const prismaCli = path.join(path.dirname(prismaPackage), 'build/index.js');
      execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
        cwd: path.join(repo, 'packages/db'),
        env: { ...process.env, DATABASE_URL: url.toString() },
        stdio: 'pipe',
      });
      user = await prisma.user.create({
        data: { name: 'Generation reliability fixture', email: `${schema}@invalid.test` },
      });
      canvas = await prisma.canvas.create({
        data: { userId: user.id, name: 'Generation reliability fixture' },
      });
      // Existing reliability scenarios intentionally exercise many paid tasks.
      await prisma.platformSetting.update({
        where: { key: 'signupCredits' },
        data: { value: 100000 },
      });
      await prisma.platformSetting.upsert({
        where: { key: 'maxConcurrent' },
        create: { key: 'maxConcurrent', value: 100 },
        update: { value: 100 },
      });
      service = new GenerationTasksService(prisma, config, queue, credits);

      await suite.test('video references accept one uploaded or library image and reject invalid references', async () => {
        const directory = path.join(storage, 'users', user.id, 'uploads');
        fs.mkdirSync(directory, { recursive: true });
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK0cAAAAASUVORK5CYII=', 'base64');
        const file = path.join(directory, 'frame.png');
        fs.writeFileSync(file, png);
        const folder = await prisma.assetFolder.create({ data: { userId: user.id, name: 'Frames' } });
        const library = await prisma.asset.create({ data: { userId: user.id, folderId: folder.id, kind: 'image', source: 'ai', status: 'ready', name: 'Library frame', url: `/files/users/${user.id}/uploads/frame.png` } });
        const uploaded = await prisma.asset.create({ data: { userId: user.id, canvasId: canvas.id, kind: 'image', source: 'upload', status: 'ready', name: 'Uploaded frame', url: `/files/users/${user.id}/uploads/frame.png`, localPath: file, historyDeletedAt: new Date() } });
        await assert.rejects(create({ imageAssetIds: [library.id, uploaded.id] }), /最多支持一张参考图/);
        for (const asset of [library, uploaded]) {
          const task = await create({ imageAssetIds: [asset.id], size: '1920x1080', fps: 60, quality: 'quality' });
          const row = await prisma.generationTask.findUniqueOrThrow({ where: { id: task.id } });
          assert.deepEqual(row.input.imageAssetIds, [asset.id]);
          assert.deepEqual(row.input.references.map((ref) => ref.assetId), [asset.id]);
          assert.equal(row.input.fps, 60);
          assert.deepEqual(await freshWorker().encodeImages(user.id, [asset.id]), [`data:image/png;base64,${png.toString('base64')}`]);
          await step(freshWorker({ submitVideo: async () => { throw new AiGenError('Fixture complete', 400); } }), task.items[0].id);
        }
        fs.writeFileSync(file, Buffer.alloc(5 * 1024 * 1024 + 1));
        await assert.rejects(create({ imageAssetIds: [uploaded.id] }), /不能超过 5MB/);
        fs.writeFileSync(file, 'GIF89a');
        await assert.rejects(create({ imageAssetIds: [uploaded.id] }), /仅支持 PNG/);
        fs.writeFileSync(file, png);
        // Another account's ready image must remain inaccessible.
        const stranger = await prisma.user.create({ data: { email: `${randomUUID()}@invalid.test`, name: 'Other' } });
        const foreignCanvas = await prisma.canvas.create({ data: { userId: stranger.id, name: 'Private' } });
        const foreign = await prisma.asset.create({ data: { userId: stranger.id, canvasId: foreignCanvas.id, kind: 'image', source: 'upload', status: 'ready', name: 'Private', localPath: file } });
        await assert.rejects(create({ imageAssetIds: [foreign.id] }), /参考图片不可用/);
        // Leave no queued job/credit hold behind for subsequent reliability scenarios.
        fs.unlinkSync(file);
      });

      await suite.test(
        'deleting a canvas retains billing history and atomically settles all outputs, including concurrent submission',
        async () => {
          const fixture = await prisma.user.create({
            data: { name: 'Deletion fixture', email: `${randomUUID()}@invalid.test` },
          });
          const canvases = new CanvasesService(prisma, credits);
          const scope = await canvases.create(fixture.id, { name: 'Delete billing' });
          const task = await service.create(fixture.id, {
            requestId: randomUUID(),
            canvasId: scope.id,
            kind: 'image',
            count: 4,
            prompt: '删除结算测试',
          });
          await prisma.generationTaskItem.update({
            where: { id: task.items[0].id },
            data: { status: 'completed' },
          });
          await prisma.generationTaskItem.update({
            where: { id: task.items[1].id },
            data: { status: 'unknown', providerTaskId: 'unknown-before-deletion' },
          });
          await canvases.remove(fixture.id, scope.id);
          const saved = await prisma.generationTask.findUniqueOrThrow({
            where: { id: task.id },
            include: { items: true },
          });
          assert.equal(saved.canvasId, null);
          assert.equal(saved.status, 'failed');
          assert.equal(saved.items.filter((item) => item.status === 'completed').length, 1);
          assert.ok(saved.items.every((item) => item.assetId === null));
          let account = await credits.balance(fixture.id);
          assert.deepEqual([account.available, account.frozen, account.spent], [99990, 0, 10]);
          assert.equal((await service.get(fixture.id, task.id)).items.length, 4);
          const concurrent = await canvases.create(fixture.id, {
            name: 'Delete racing submission',
          });
          await Promise.allSettled([
            service.create(fixture.id, {
              requestId: randomUUID(),
              canvasId: concurrent.id,
              kind: 'image',
              prompt: '并发删除',
            }),
            canvases.remove(fixture.id, concurrent.id),
          ]);
          assert.equal(await prisma.canvas.count({ where: { id: concurrent.id } }), 0);
          account = await credits.balance(fixture.id);
          assert.equal(account.frozen, 0);
          assert.equal(
            await prisma.creditHold.count({ where: { userId: fixture.id, status: 'held' } }),
            0,
          );
        },
      );

      await suite.test(
        'chat success commits messages and credits together; stream failures and disconnects refund',
        async () => {
          const fixture = await prisma.user.create({
            data: { name: 'Chat billing fixture', email: `${randomUUID()}@invalid.test` },
          });
          const scope = await prisma.canvas.create({
            data: { userId: fixture.id, name: 'Chat billing' },
          });
          const llm = {
            chat: async () => ({ text: '测试标题' }),
            chatStream: async function* () {
              yield '测试回答';
            },
          };
          const chat = new CanvasChatService(prisma, llm, credits, config);
          const conversation = await chat.create(fixture.id, scope.id);
          const signal = new AbortController().signal;
          const events = [];
          for await (const event of chat.sendStream(
            fixture.id,
            scope.id,
            conversation.id,
            '测试问题',
            [],
            signal,
          ))
            events.push(event);
          assert.equal(events.at(-1).event, 'done');
          let account = await credits.balance(fixture.id);
          assert.deepEqual([account.available, account.frozen, account.spent], [99999, 0, 1]);
          assert.equal(
            await prisma.canvasChatMessage.count({ where: { conversationId: conversation.id } }),
            2,
          );
          llm.chatStream = async function* () {
            yield '部分回答';
            throw new Error('provider disconnected');
          };
          await assert.rejects(async () => {
            for await (const event of chat.sendStream(
              fixture.id,
              scope.id,
              conversation.id,
              '失败问题',
              [],
              signal,
            ))
              void event;
          }, /provider disconnected/);
          llm.chatStream = async function* () {
            yield '部分回答';
            yield '剩余回答';
          };
          const interrupted = chat.sendStream(
            fixture.id,
            scope.id,
            conversation.id,
            '断开连接',
            [],
            signal,
          );
          await interrupted.next();
          await interrupted.return();
          account = await credits.balance(fixture.id);
          assert.deepEqual([account.available, account.frozen, account.spent], [99999, 0, 1]);
          assert.equal(
            await prisma.canvasChatMessage.count({ where: { conversationId: conversation.id } }),
            2,
          );
          assert.equal(
            await prisma.creditEntry.count({ where: { userId: fixture.id, type: 'refund' } }),
            2,
          );
        },
      );

      await suite.test(
        'daily and concurrent limits include chat; expired synchronous operations refund after restart',
        async () => {
          const fixture = await prisma.user.create({
            data: { name: 'Limits fixture', email: `${randomUUID()}@invalid.test` },
          });
          const before = await admin.settings();
          try {
            await admin.saveSettings(user.id, {
              signupCredits: 100000,
              dailyCredits: 3,
              maxConcurrent: 2,
            });
            const first = await credits.beginOperation(fixture.id, { kind: 'chat' });
            const second = await credits.beginOperation(fixture.id, { kind: 'text' });
            await assert.rejects(
              credits.beginOperation(fixture.id, { kind: 'chat' }),
              (error) => error.getStatus() === 429 && /同时最多/.test(error.message),
            );
            await credits.finishOperation(first.id, false);
            await credits.finishOperation(second.id, true);
            const expiring = await credits.beginOperation(fixture.id, { kind: 'chat' });
            await assert.rejects(
              prisma.$transaction((tx) =>
                credits.reserve(tx, fixture.id, 2, `daily:${fixture.id}`, '超过日额度'),
              ),
              (error) => error.getStatus() === 429 && /每日/.test(error.message),
            );
            await prisma.creditHold.update({
              where: { id: expiring.id },
              data: { expiresAt: new Date(0) },
            });
            const restarted = new CreditsService(prisma, config);
            await restarted.expireHolds();
            const account = await credits.balance(fixture.id);
            assert.deepEqual([account.available, account.frozen, account.spent], [99999, 0, 1]);
            assert.equal(
              (await prisma.creditHold.findUniqueOrThrow({ where: { id: expiring.id } })).status,
              'refunded',
            );
          } finally {
            await admin.saveSettings(user.id, before);
          }
        },
      );

      await suite.test(
        'HTTP admin permissions, validation, private balances and account disable take effect',
        async () => {
          const { Module } = apiRequire('@nestjs/common');
          const { NestFactory } = apiRequire('@nestjs/core');
          const { ConfigService } = apiRequire('@nestjs/config');
          const { ZodValidationPipe } = apiRequire('nestjs-zod');
          class HttpFixture {}
          Module({
            controllers: [AuthController, CreditsController, AdminController],
            providers: [
              AuthGuard,
              AdminGuard,
              { provide: PrismaService, useValue: prisma },
              { provide: ConfigService, useValue: config },
              { provide: AuthService, useValue: new AuthService(prisma, config) },
              { provide: CreditsService, useValue: credits },
              { provide: AdminService, useValue: admin },
            ],
          })(HttpFixture);
          const app = await NestFactory.create(HttpFixture, { logger: false });
          app.useGlobalPipes(new ZodValidationPipe());
          app.useGlobalFilters(new ZodExceptionFilter());
          await app.listen(0, '127.0.0.1');
          const base = await app.getUrl();
          const call = (endpoint, cookie, body, method = 'POST') =>
            fetch(`${base}${endpoint}`, {
              method: body === undefined ? 'GET' : method,
              headers: {
                ...(cookie ? { Cookie: cookie } : {}),
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
              },
              ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
          try {
            assert.equal((await call('/admin/overview')).status, 401);
            const email = `${randomUUID()}@invalid.test`;
            let response = await call('/auth/register', null, {
              email,
              name: 'HTTP fixture',
              password: 'isolated-password123',
            });
            assert.equal(response.status, 201);
            const registered = (await response.json()).user;
            const cookie = response.headers.get('set-cookie').split(';')[0];
            assert.equal((await call('/admin/users', cookie)).status, 403);
            response = await call('/credits/balance', cookie);
            assert.equal(response.status, 200);
            assert.equal((await response.json()).userId, registered.id);
            await prisma.user.update({ where: { id: registered.id }, data: { role: 'admin' } });
            assert.equal((await call('/admin/overview', cookie)).status, 200);
            response = await call('/admin/prices', cookie, {
              kind: 'image',
              model: '*',
              unit: 'second',
              credits: -1,
              enabled: true,
            });
            assert.equal(response.status, 400);
            response = await call('/admin/ledger?page=-1', cookie);
            assert.equal(response.status, 400);
            assert.equal((await call('/admin/tasks', cookie)).status, 200);
            assert.equal((await call('/admin/audits', cookie)).status, 200);
            await prisma.user.update({
              where: { id: registered.id },
              data: { status: 'disabled' },
            });
            assert.equal((await call('/credits/balance', cookie)).status, 401);
            assert.equal((await call('/admin/overview', cookie)).status, 401);
          } finally {
            await app.close();
          }
        },
      );

      await suite.test('admin guard rejects ordinary users even when authenticated', () => {
        const guard = new AdminGuard();
        const context = (role) => ({
          switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
        });
        assert.throws(() => guard.canActivate(context('user')), /管理员权限/);
        assert.equal(guard.canActivate(context('admin')), true);
      });

      await suite.test(
        'credits serialize concurrent first-use grants, debits and idempotent settlements',
        async () => {
          const fixture = await prisma.user.create({
            data: { name: 'Credits fixture', email: `${randomUUID()}@invalid.test` },
          });
          const balances = await Promise.all(
            Array.from({ length: 5 }, () => credits.balance(fixture.id)),
          );
          assert.ok(balances.every((value) => value.available === 100000));
          assert.equal(
            await prisma.creditEntry.count({ where: { userId: fixture.id, type: 'grant' } }),
            1,
          );
          await admin.adjust(user.id, fixture.id, {
            requestId: randomUUID(),
            amount: -99900,
            reason: '设置测试额度',
          });
          const attempts = await Promise.allSettled(
            Array.from({ length: 4 }, (_, index) =>
              prisma.$transaction((tx) =>
                credits.reserve(tx, fixture.id, 40, `race-${index}-${fixture.id}`, '并发生成'),
              ),
            ),
          );
          assert.equal(attempts.filter((value) => value.status === 'fulfilled').length, 2);
          assert.ok(
            attempts
              .filter((value) => value.status === 'rejected')
              .every((value) => value.reason.getStatus() === 402),
          );
          let account = await credits.balance(fixture.id);
          assert.deepEqual([account.available, account.frozen], [20, 80]);
          const holds = attempts
            .filter((value) => value.status === 'fulfilled')
            .map((value) => value.value);
          await Promise.all(
            Array.from({ length: 3 }, () => credits.finishOperation(holds[0].id, true)),
          );
          await Promise.all(
            Array.from({ length: 3 }, () => credits.finishOperation(holds[1].id, false)),
          );
          account = await credits.balance(fixture.id);
          assert.deepEqual([account.available, account.frozen, account.spent], [60, 0, 40]);
          assert.equal(
            await prisma.creditEntry.count({ where: { userId: fixture.id, type: 'capture' } }),
            1,
          );
          assert.equal(
            await prisma.creditEntry.count({ where: { userId: fixture.id, type: 'refund' } }),
            1,
          );
          const adjustment = { requestId: randomUUID(), amount: 10, reason: '测试重复发放' };
          await Promise.all([
            admin.adjust(user.id, fixture.id, adjustment),
            admin.adjust(user.id, fixture.id, adjustment),
          ]);
          assert.equal((await credits.balance(fixture.id)).available, 70);
          await assert.rejects(
            admin.adjust(user.id, fixture.id, { ...adjustment, amount: 11 }),
            /同一请求/,
          );
          await assert.rejects(
            admin.adjust(user.id, fixture.id, {
              ...adjustment,
              requestId: randomUUID(),
              amount: -71,
            }),
            /超过可用积分/,
          );
          assert.equal(await prisma.adminAudit.count({ where: { targetId: fixture.id } }), 2);
        },
      );

      await suite.test(
        'batch pricing snapshots survive price changes; partial failure refunds only failed outputs',
        async () => {
          const fixture = await prisma.user.create({
            data: { name: 'Billing batch fixture', email: `${randomUUID()}@invalid.test` },
          });
          const scope = await prisma.canvas.create({
            data: { userId: fixture.id, name: 'Credits batch' },
          });
          const input = {
            requestId: randomUUID(),
            canvasId: scope.id,
            nodeId: randomUUID(),
            kind: 'image',
            model: 'billing-test-model',
            count: 4,
            prompt: '收费测试',
          };
          const batch = await service.create(fixture.id, input);
          await service.create(fixture.id, input);
          assert.equal((await credits.balance(fixture.id)).frozen, 40);
          await admin.savePrice(user.id, {
            kind: 'image',
            model: 'billing-test-model',
            unit: 'request',
            credits: 99,
            enabled: true,
          });
          await prisma.generationTaskItem.updateMany({
            where: { taskId: batch.id },
            data: { status: 'completed' },
          });
          await prisma.generationTaskItem.update({
            where: { id: batch.items[3].id },
            data: { status: 'failed', providerResult: { url: 'https://invalid.test/media' } },
          });
          await Promise.all([service.refresh(batch.id), service.refresh(batch.id)]);
          let account = await credits.balance(fixture.id);
          assert.deepEqual([account.available, account.frozen, account.spent], [99970, 0, 30]);
          const saved = await prisma.generationTask.findUniqueOrThrow({ where: { id: batch.id } });
          assert.equal(saved.creditQuote.total, 40);
          await service.resume(fixture.id, batch.id);
          assert.equal((await credits.balance(fixture.id)).frozen, 10);
          await prisma.generationTaskItem.update({
            where: { id: batch.items[3].id },
            data: { status: 'completed' },
          });
          await service.refresh(batch.id);
          account = await credits.balance(fixture.id);
          assert.deepEqual([account.available, account.frozen, account.spent], [99960, 0, 40]);
          assert.equal(
            (await credits.quote({ kind: 'image', model: 'billing-test-model', count: 4 })).total,
            396,
          );
          await admin.savePrice(user.id, {
            kind: 'image',
            model: 'billing-test-model',
            unit: 'request',
            credits: 99,
            enabled: false,
          });
          await assert.rejects(
            credits.quote({ kind: 'image', model: 'billing-test-model' }),
            /暂未开放/,
          );
        },
      );

      await suite.test(
        'insufficient credits roll back the entire task, items and assets',
        async () => {
          const fixture = await prisma.user.create({
            data: { name: 'Insufficient fixture', email: `${randomUUID()}@invalid.test` },
          });
          const scope = await prisma.canvas.create({
            data: { userId: fixture.id, name: 'Insufficient' },
          });
          await credits.balance(fixture.id);
          await admin.adjust(user.id, fixture.id, {
            requestId: randomUUID(),
            amount: -99995,
            reason: '不足余额测试',
          });
          await assert.rejects(
            service.create(fixture.id, {
              requestId: randomUUID(),
              canvasId: scope.id,
              kind: 'image',
              prompt: '测试',
            }),
            (error) => error.getStatus() === 402,
          );
          assert.equal(await prisma.generationTask.count({ where: { userId: fixture.id } }), 0);
          assert.equal(await prisma.asset.count({ where: { userId: fixture.id } }), 0);
          assert.deepEqual(
            [
              (await credits.balance(fixture.id)).available,
              (await credits.balance(fixture.id)).frozen,
            ],
            [5, 0],
          );
        },
      );

      await suite.test(
        'unknown results retain frozen credits and restart recovery settles a committed result once',
        async () => {
          const batch = await create({ kind: 'text' });
          const holdId = (
            await prisma.generationTaskItem.findUniqueOrThrow({ where: { id: batch.items[0].id } })
          ).creditHoldId;
          await prisma.generationTaskItem.update({
            where: { id: batch.items[0].id },
            data: { status: 'unknown', providerTaskId: 'pending-provider' },
          });
          await service.refresh(batch.id);
          assert.equal(
            (await prisma.creditHold.findUniqueOrThrow({ where: { id: holdId } })).status,
            'held',
          );
          await prisma.generationTaskItem.update({
            where: { id: batch.items[0].id },
            data: { status: 'completed' },
          });
          const restarted = new GenerationTasksService(
            prisma,
            config,
            queue,
            new CreditsService(prisma, config),
          );
          await restarted.dispatchDue();
          await restarted.refresh(batch.id);
          assert.equal(
            (await prisma.creditHold.findUniqueOrThrow({ where: { id: holdId } })).status,
            'captured',
          );
          assert.equal(await prisma.creditEntry.count({ where: { key: `${holdId}:captured` } }), 1);
        },
      );

      await suite.test(
        'saving media or text to the asset library never adds generation history',
        async () => {
          const assets = new AssetsService(prisma, config);
          const folders = new AssetFoldersService(prisma);
          const folder = await prisma.assetFolder.create({
            data: { userId: user.id, name: '资产副本测试' },
          });
          const originals = [];
          for (const kind of ['image', 'video', 'text']) {
            originals.push(
              await prisma.asset.create({
                data: {
                  userId: user.id,
                  canvasId: canvas.id,
                  kind,
                  source: 'ai',
                  status: 'ready',
                  name: `原始生成${kind}`,
                  prompt: '保存副本不生成新素材',
                  model: `test-${kind}-model`,
                  content: kind === 'text' ? '原始生成文本' : null,
                  url:
                    kind !== 'text'
                      ? `/files/test/original.${kind === 'image' ? 'png' : 'mp4'}`
                      : null,
                  references: [{ kind: 'text', name: '参考', content: '参考内容' }],
                },
              }),
            );
          }
          const before = (await assets.history(user.id, { scope: 'all' }))
            .map((asset) => asset.id)
            .sort();
          const copies = [];
          for (const original of originals.filter((asset) => asset.kind !== 'text')) {
            const copy = await assets.saveToLibrary(user.id, original.id, {
              folderId: folder.id,
              name: '资产库副本',
            });
            copies.push(copy);
            assert.notEqual(copy.id, original.id);
            assert.equal(copy.prompt, original.prompt);
            assert.equal(copy.model, original.model);
            assert.deepEqual(copy.references, original.references);
          }
          copies.push(
            await folders.createTextAsset(user.id, folder.id, {
              name: '保存生成文本',
              content: '编辑后的文本',
              prompt: '保存副本不生成新素材',
              sourceAssetId: originals[2].id,
            }),
          );
          copies.push(
            await folders.createTextAsset(user.id, folder.id, {
              name: '手写文本',
              content: '手写的画布内容',
            }),
          );
          assert.deepEqual(
            (await assets.history(user.id, { scope: 'all' })).map((asset) => asset.id).sort(),
            before,
          );
          assert.deepEqual(
            (await assets.history(user.id, { scope: 'canvas', canvasId: canvas.id }))
              .map((asset) => asset.id)
              .sort(),
            before,
          );
          assert.deepEqual(
            (await assets.history(user.id, { scope: 'all', q: '保存副本不生成新素材' }))
              .map((asset) => asset.id)
              .sort(),
            before,
          );
          assert.deepEqual(
            (await folders.listAssets(user.id, folder.id)).map((asset) => asset.id).sort(),
            copies.map((asset) => asset.id).sort(),
          );
          await assert.rejects(
            () => assets.removeHistory(user.id, copies[0].id),
            (error) => error.getStatus() === 404,
          );
          await assets.removeHistory(user.id, originals[0].id);
          assert.equal(
            (await assets.history(user.id, { scope: 'all' })).some(
              (asset) => asset.id === originals[0].id,
            ),
            false,
          );
          assert.equal((await folders.listAssets(user.id, folder.id)).length, 4);
        },
      );

      await suite.test(
        'canvas image/video/audio uploads stay outside history and enforce ownership/type/size',
        async () => {
          const assets = new AssetsService(prisma, config);
          const uploadCanvas = await prisma.canvas.create({
            data: { userId: user.id, name: 'Upload history' },
          });
          const uploaded = [];
          for (const kind of ['image', 'video', 'audio']) {
            const extension = kind === 'image' ? 'png' : kind === 'audio' ? 'wav' : 'mp4';
            const filename = `${randomUUID()}.${extension}`;
            const filePath = path.join(storage, filename);
            if (kind === 'image')
              fs.writeFileSync(
                filePath,
                Buffer.from(
                  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
                  'base64',
                ),
              );
            else if (kind === 'audio')
              execFileSync(
                apiRequire('@ffmpeg-installer/ffmpeg').path,
                ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.1', '-y', filePath],
                { stdio: 'pipe' },
              );
            else
              execFileSync(
                apiRequire('@ffmpeg-installer/ffmpeg').path,
                [
                  '-f',
                  'lavfi',
                  '-i',
                  'color=c=blue:s=16x16:d=0.1',
                  '-c:v',
                  'libx264',
                  '-pix_fmt',
                  'yuv420p',
                  '-y',
                  filePath,
                ],
                { stdio: 'pipe' },
              );
            const asset = await assets.createFromCanvasUpload(user.id, uploadCanvas.id, kind, {
              path: filePath,
              filename,
              originalname: `upload-history-${kind}.${extension}`,
              mimetype: `${kind}/${extension}`,
              size: fs.statSync(filePath).size,
            });
            assert.equal(asset.canvasId, uploadCanvas.id);
            assert.equal(asset.projectId, null);
            assert.equal(asset.source, 'upload');
            assert.equal(asset.status, 'ready');
            assert.equal(asset.kind, kind);
            assert.equal(asset.name, `upload-history-${kind}.${extension}`);
            uploaded.push(asset);
          }
          assert.equal(
            (await assets.history(user.id, { scope: 'canvas', canvasId: uploadCanvas.id })).length,
            0,
          );
          assert.equal(
            (await assets.history(user.id, { scope: 'all', q: 'upload-history' })).length,
            0,
          );
          const folder = await prisma.assetFolder.create({
            data: { userId: user.id, name: 'Uploaded library copy' },
          });
          const copy = await assets.saveToLibrary(user.id, uploaded[0].id, { folderId: folder.id });
          assert.ok(
            !(await assets.history(user.id, { scope: 'all' })).some(
              (asset) => asset.id === copy.id,
            ),
          );
          await assets.removeHistory(user.id, uploaded[0].id);
          assert.equal(
            (await assets.history(user.id, { scope: 'canvas', canvasId: uploadCanvas.id })).length,
            0,
          );
          assert.equal((await assets.findOne(user.id, uploaded[0].id)).status, 'ready');
          for (const [owner, kind, code] of [
            [randomUUID(), 'image', 404],
            [user.id, 'video', 400],
          ]) {
            const filePath = path.join(storage, `${randomUUID()}.png`);
            fs.writeFileSync(filePath, 'invalid');
            await assert.rejects(
              () =>
                assets.createFromCanvasUpload(owner, uploadCanvas.id, kind, {
                  path: filePath,
                  filename: path.basename(filePath),
                  originalname: 'rejected',
                  mimetype: 'image/png',
                }),
              (error) => error.getStatus() === code,
            );
            assert.ok(!fs.existsSync(filePath));
          }
          await assets.removeHistory(user.id, uploaded[1].id);
          const oversizedPath = path.join(storage, `${randomUUID()}.png`);
          fs.writeFileSync(oversizedPath, 'oversized placeholder');
          await assert.rejects(
            () =>
              assets.createFromCanvasUpload(user.id, uploadCanvas.id, 'image', {
                path: oversizedPath,
                mimetype: 'image/png',
                size: 500 * 1024 * 1024 + 1,
              }),
            /500MB/,
          );
          assert.ok(!fs.existsSync(oversizedPath));
        },
      );

      await suite.test(
        'recovery lists the latest task per node and enforces ownership',
        async () => {
          const original = await create({ kind: 'text' });
          await prisma.generationTaskItem.updateMany({
            where: { taskId: original.id },
            data: { status: 'failed' },
          });
          await service.refresh(original.id);
          const latest = await create({ kind: 'text', nodeId: original.nodeId });
          const listed = await service.list(user.id, canvas.id);
          assert.equal(listed.find((task) => task.nodeId === original.nodeId).id, latest.id);
          assert.equal(
            listed.some((task) => task.id === original.id),
            false,
          );
          await assert.rejects(
            () => service.list(randomUUID(), canvas.id),
            (error) => error.getStatus() === 404,
          );
        },
      );

      await suite.test('active assets remain readable but cannot be deleted', async () => {
        const task = await create();
        const assets = new AssetsService(prisma, config);
        assert.equal((await assets.findOne(user.id, task.items[0].asset.id)).status, 'generating');
        await assert.rejects(
          () => assets.remove(user.id, task.items[0].asset.id),
          (error) => error.getStatus() === 409,
        );
      });

      await suite.test(
        'actual file saving validates media and reuses committed files after a crash',
        async () => {
          const task = await create({ kind: 'image' });
          const worker = freshWorker({
            generateImage: async () => ({
              url: 'https://invalid.test/image.png',
              model: 'cogview-3-flash',
            }),
          });
          worker.saveMedia = GenerationTasksProcessor.prototype.saveMedia;
          await step(worker, task.items[0].id);
          let downloads = 0;
          const originalFetch = global.fetch;
          const png = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lLkAAAAASUVORK5CYII=',
            'base64',
          );
          global.fetch = async () => {
            downloads++;
            return new Response(downloads === 1 ? 'invalid media' : png, { status: 200 });
          };
          try {
            let item = await step(worker, task.items[0].id);
            assert.equal(item.status, 'saving');
            item = await step(worker, task.items[0].id);
            assert.equal(item.status, 'completed');
            const asset = await prisma.asset.findUniqueOrThrow({ where: { id: item.assetId } });
            assert.equal(asset.width, 1);
            assert.equal(asset.height, 1);
            const again = await worker.saveMedia(
              item.id,
              randomUUID(),
              user.id,
              'image',
              'https://invalid.test/expired.png',
              new AbortController().signal,
            );
            assert.equal(again.localPath, asset.localPath);
            assert.equal(downloads, 2);
            assert.deepEqual(fs.readdirSync(path.dirname(asset.localPath)), [`${item.id}.png`]);
          } finally {
            global.fetch = originalFetch;
          }
        },
      );

      await suite.test(
        'four image outputs save independently without ffprobe, including WebP and GIF',
        async () => {
          const batch = await create({ kind: 'image', count: 4 });
          let submissions = 0;
          const worker = freshWorker({
            generateImage: async () => {
              return {
                url: `https://invalid.test/generated-image/${submissions++}`,
                model: 'cogview-3-flash',
              };
            },
          });
          worker.saveMedia = GenerationTasksProcessor.prototype.saveMedia;
          await Promise.all(batch.items.map((item) => step(worker, item.id)));
          const fixtures = [
            [
              'png',
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lLkAAAAASUVORK5CYII=',
            ],
            ['webp', 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA'],
            ['gif', 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'],
            [
              'png',
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lLkAAAAASUVORK5CYII=',
            ],
          ];
          const originalFetch = global.fetch;
          const probe = require('../src/modules/assets/media-probe.ts');
          const originalProbe = probe.probeMedia;
          probe.probeMedia = async () => {
            throw new Error('ffprobe unavailable');
          };
          try {
            global.fetch = async (url) =>
              new Response(
                Buffer.from(fixtures[Number(new URL(url).pathname.split('/').at(-1))][1], 'base64'),
              );
            const completed = await Promise.all(batch.items.map((item) => step(worker, item.id)));
            assert.ok(completed.every((item) => item.status === 'completed'));
            for (const item of batch.items) {
              const asset = await prisma.asset.findUniqueOrThrow({ where: { id: item.asset.id } });
              assert.equal(asset.width, 1);
              assert.equal(asset.height, 1);
              const source = completed.find((result) => result.id === item.id).providerResult.url;
              const fixture = fixtures[Number(new URL(source).pathname.split('/').at(-1))];
              assert.ok(asset.localPath.endsWith(`.${fixture[0]}`));
              global.fetch = async () => {
                throw new Error('must reuse the saved file');
              };
              assert.equal(
                (
                  await worker.saveMedia(
                    item.id,
                    randomUUID(),
                    user.id,
                    'image',
                    'https://invalid.test/expired',
                    new AbortController().signal,
                  )
                ).localPath,
                asset.localPath,
              );
            }
            assert.equal((await service.get(user.id, batch.id)).status, 'completed');
            assert.equal(submissions, 4);
          } finally {
            global.fetch = originalFetch;
            probe.probeMedia = originalProbe;
          }
        },
      );

      await suite.test(
        'concurrent idempotent submissions create exactly one batch; active node rejects another request',
        async () => {
          const body = {
            requestId: randomUUID(),
            canvasId: canvas.id,
            nodeId: randomUUID(),
            kind: 'video',
            prompt: '批量视频',
            count: 4,
          };
          const results = await Promise.all(
            Array.from({ length: 6 }, () => service.create(user.id, body)),
          );
          assert.equal(new Set(results.map((task) => task.id)).size, 1);
          assert.equal(
            await prisma.generationTaskItem.count({ where: { taskId: results[0].id } }),
            4,
          );
          assert.equal(results[0].items.length, 4);
          await assert.rejects(
            () => service.create(user.id, { ...body, requestId: randomUUID() }),
            (error) => error.getStatus() === 409,
          );
          await assert.rejects(
            () => service.create(user.id, { ...body, prompt: '不同参数' }),
            (error) => error.getStatus() === 409,
          );
          await assert.rejects(
            () => service.get(randomUUID(), results[0].id),
            (error) => error.getStatus() === 404,
          );
          const persisted = await prisma.generationTask.findUniqueOrThrow({
            where: { id: results[0].id },
          });
          assert.equal(persisted.input.count, 4);
          assert.equal(persisted.model, 'cogvideox-flash');
        },
      );

      await suite.test(
        'restart and query/download failures never repeat video submission',
        async () => {
          let submissions = 0;
          let queries = 0;
          let saves = 0;
          const task = await create();
          const id = task.items[0].id;
          await step(
            freshWorker({
              submitVideo: async () => {
                submissions++;
                return 'provider-original-id';
              },
            }),
            id,
          );
          let item = await prisma.generationTaskItem.findUniqueOrThrow({ where: { id } });
          assert.equal(item.providerTaskId, 'provider-original-id');
          assert.equal(item.status, 'generating');
          service = new GenerationTasksService(prisma, config, queue, credits); // new process, same durable storage
          const worker = freshWorker({
            getVideoResult: async (providerId) => {
              assert.equal(providerId, 'provider-original-id');
              if (++queries === 1) throw new Error('query connection lost');
              return { status: 'completed', url: 'https://invalid.test/generated.mp4' };
            },
          });
          item = await step(worker, id);
          assert.equal(item.status, 'generating');
          assert.equal(item.pollFailures, 1);
          item = await step(worker, id);
          assert.equal(item.status, 'saving');
          worker.saveMedia = async () => {
            if (++saves === 1) throw new Error('download connection lost');
            return {
              url: '/files/test/video.mp4',
              localPath: '/private/tmp/test-video.mp4',
              width: 1280,
              height: 720,
              durationInFrames: 150,
            };
          };
          item = await step(worker, id);
          assert.equal(item.status, 'saving');
          assert.ok(item.providerResult);
          item = await step(worker, id);
          assert.equal(item.status, 'completed');
          assert.equal(submissions, 1);
          assert.equal(queries, 2);
          assert.equal(saves, 2);
          const completed = await service.get(user.id, task.id);
          assert.equal(completed.status, 'completed');
          assert.equal(completed.items[0].asset.id, task.items[0].asset.id);
          assert.equal(completed.items[0].asset.status, 'ready');
          assert.equal(await prisma.asset.count({ where: { id: task.items[0].asset.id } }), 1);
          assert.equal(
            (await prisma.generationTask.findUniqueOrThrow({ where: { id: task.id } }))
              .activeNodeKey,
            null,
          );
        },
      );

      await suite.test(
        'ambiguous submission and crash in submitting stay locked and never auto-resubmit',
        async () => {
          let calls = 0;
          const worker = freshWorker({
            submitVideo: async () => {
              calls++;
              throw new AiGenError('response lost');
            },
          });
          const task = await create();
          let item = await step(worker, task.items[0].id);
          assert.equal(item.status, 'unknown');
          await step(worker, item.id);
          assert.equal(calls, 1);
          await assert.rejects(
            () => create({ nodeId: task.nodeId }),
            (error) => error.getStatus() === 409,
          );
          await assert.rejects(
            () => service.resume(user.id, task.id),
            (error) => error.getStatus() === 409,
          );
          const crashed = await create();
          await prisma.generationTaskItem.update({
            where: { id: crashed.items[0].id },
            data: { status: 'submitting', leaseToken: 'dead-process', leaseExpiresAt: new Date(0) },
          });
          item = await step(worker, crashed.items[0].id);
          assert.equal(item.status, 'unknown');
          assert.equal(calls, 1);
        },
      );

      await suite.test(
        '429 retries once, then fails and releases the node for another model',
        async () => {
          let calls = 0;
          const worker = freshWorker({
            submitVideo: async () => {
              calls++;
              throw new AiGenError('busy', 429);
            },
          });
          const task = await create();
          for (let i = 1; i <= 2; i++) {
            const item = await step(worker, task.items[0].id);
            assert.equal(item.error, '模型繁忙，请更换模型或稍后再试');
            assert.equal(item.attemptCount, i);
            assert.equal(item.status, i === 2 ? 'failed' : 'queued');
            if (i < 2) assert.ok(item.nextRunAt.getTime() >= Date.now() + 14000);
          }
          await step(worker, task.items[0].id);
          assert.equal(calls, 2);
          const replacement = await create({ nodeId: task.nodeId, model: 'another-video-model' });
          assert.notEqual(replacement.id, task.id);
          assert.equal(replacement.model, 'another-video-model');
          // Already queued under an older retry policy must not submit a third time after upgrade.
          const pending = await create();
          await prisma.generationTaskItem.update({
            where: { id: pending.items[0].id },
            data: { attemptCount: 2, errorCode: 'MODEL_BUSY' },
          });
          const exhausted = await step(worker, pending.items[0].id);
          assert.equal(exhausted.status, 'failed');
          assert.equal(exhausted.error, '模型繁忙，请更换模型或稍后再试');
          assert.equal(calls, 2);
        },
      );

      await suite.test(
        'expired polling resumes original task; manual resume is serialized',
        async () => {
          let calls = 0;
          const task = await create();
          const id = task.items[0].id;
          await prisma.generationTaskItem.update({
            where: { id },
            data: {
              status: 'generating',
              providerTaskId: 'persisted-id',
              pollFailures: 9,
              leaseToken: 'crashed',
              leaseExpiresAt: new Date(0),
            },
          });
          await step(
            freshWorker({
              getVideoResult: async () => {
                throw new Error('unavailable');
              },
            }),
            id,
          );
          assert.equal((await service.get(user.id, task.id)).canResume, true);
          const attempts = await Promise.allSettled([
            service.resume(user.id, task.id),
            service.resume(user.id, task.id),
          ]);
          assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
          const item = await step(
            freshWorker({
              getVideoResult: async (providerId) => {
                calls++;
                assert.equal(providerId, 'persisted-id');
                return { status: 'completed', url: 'https://invalid.test/video' };
              },
            }),
            id,
          );
          assert.equal(item.status, 'saving');
          assert.equal(calls, 1);
        },
      );

      await suite.test(
        'save exhaustion is resumable without regenerating; text and image share durable checkpoints',
        async () => {
          let imageCalls = 0;
          const image = await create({
            kind: 'image',
            prompt: '合成后的提示词',
            userPrompt: '用户提示词',
            references: [{ kind: 'text', name: '参考文本', content: '参考内容' }],
          });
          const worker = freshWorker({
            generateImage: async () => {
              imageCalls++;
              return { url: 'https://invalid.test/image.png', model: 'cogview-3-flash' };
            },
          });
          await step(worker, image.items[0].id);
          worker.saveMedia = async () => {
            throw new Error('storage unavailable');
          };
          for (let i = 0; i < 5; i++) await step(worker, image.items[0].id);
          assert.equal((await service.get(user.id, image.id)).status, 'failed');
          assert.equal((await service.get(user.id, image.id)).canResume, true);
          await service.resume(user.id, image.id);
          await step(freshWorker(), image.items[0].id);
          const saved = await service.get(user.id, image.id);
          assert.equal(saved.status, 'completed');
          assert.equal(saved.items[0].asset.prompt, '用户提示词');
          assert.equal(saved.items[0].asset.references[0].content, '参考内容');
          assert.equal(imageCalls, 1);
          let textCalls = 0;
          const text = await create({ kind: 'text' });
          const textWorker = freshWorker(
            {},
            {
              generateContent: async () => {
                textCalls++;
                return { text: '最终文本', model: 'glm-4-flash' };
              },
            },
          );
          await step(textWorker, text.items[0].id);
          await step(freshWorker(), text.items[0].id);
          const completed = await service.get(user.id, text.id);
          assert.equal(completed.items[0].asset.content, '最终文本');
          assert.equal(completed.items[0].asset.model, 'glm-4-flash');
          assert.equal(textCalls, 1);
        },
      );

      await suite.test(
        'duplicate workers are fenced; stale lease cannot overwrite a newer checkpoint',
        async () => {
          const task = await create();
          const id = task.items[0].id;
          let release;
          let entered;
          let calls = 0;
          const started = new Promise((resolve) => {
            entered = resolve;
          });
          const waiting = new Promise((resolve) => {
            release = resolve;
          });
          const worker = freshWorker({
            submitVideo: async () => {
              calls++;
              entered();
              await waiting;
              return 'old-response';
            },
          });
          const original = await prisma.generationTaskItem.findUniqueOrThrow({ where: { id } });
          const work = worker.process({ data: { id, revision: original.revision } });
          await started;
          await worker.process({ data: { id, revision: original.revision } });
          assert.equal(calls, 1);
          await prisma.generationTaskItem.update({
            where: { id },
            data: {
              leaseToken: 'new-owner',
              providerTaskId: 'new-checkpoint',
              status: 'generating',
            },
          });
          release();
          await work;
          const item = await prisma.generationTaskItem.findUniqueOrThrow({ where: { id } });
          assert.equal(item.providerTaskId, 'new-checkpoint');
          assert.equal(item.leaseToken, 'new-owner');
        },
      );

      await suite.test(
        'Redis outage leaves a durable task; a fresh dispatcher recovers it',
        async () => {
          const offline = new GenerationTasksService(
            prisma,
            config,
            {
              add: async () => {
                throw new Error('Redis offline');
              },
            },
            credits,
          );
          const task = await offline.create(user.id, {
            requestId: randomUUID(),
            canvasId: canvas.id,
            nodeId: randomUUID(),
            kind: 'text',
            prompt: '排队',
          });
          await offline.dispatchDue();
          const recovery = new GenerationTasksService(prisma, config, queue, credits);
          await recovery.dispatchDue();
          assert.ok(enqueued.some((job) => job.data.id === task.items[0].id));
          assert.equal((await recovery.get(user.id, task.id)).status, 'queued');
        },
      );

      await suite.test(
        'browser recovery restores status and applies partial batch outputs exactly once',
        async () => {
          const task = await create({ kind: 'text', count: 4 });
          const worker = freshWorker();
          for (const item of task.items.slice(0, 3)) {
            await step(worker, item.id);
            await step(worker, item.id);
          }
          await prisma.generationTaskItem.update({
            where: { id: task.items[3].id },
            data: { status: 'failed', error: 'one item failed' },
          });
          await service.refresh(task.id);
          const result = await service.get(user.id, task.id);
          const nodes = [
            {
              id: task.nodeId,
              type: 'workflow',
              position: { x: 0, y: 0 },
              data: { kind: 'text', title: '文案', content: '' },
            },
          ];
          const edges = [{ id: 'reference', source: 'upstream', target: task.nodeId }];
          const active = recoverGenerationTasks(
            nodes,
            edges,
            [{ ...result, status: 'saving' }],
            () => 400,
          );
          assert.equal(active.nodes.length, 1);
          assert.equal(active.nodes[0].data.status, 'generating');
          const recovered = recoverGenerationTasks(active.nodes, edges, [result], () => 400);
          assert.equal(recovered.nodes.length, 4);
          assert.equal(recovered.edges.length, 4);
          assert.equal(recovered.nodes[0].data.content, '测试结果');
          const failedNode = recovered.nodes.find((node) => node.data.status === 'failed');
          assert.equal(failedNode.id, result.items[3].asset.id);
          assert.equal(failedNode.data.error, 'one item failed');
          assert.equal(failedNode.data.content, '');
          assert.equal(failedNode.data.url, null);
          assert.equal(failedNode.data.generationCount, 1);
          assert.equal(generationFeedbackMessage(failedNode.data), 'one item failed');
          const again = recoverGenerationTasks(
            recovered.nodes,
            recovered.edges,
            [result],
            () => 400,
          );
          assert.equal(again.nodes, recovered.nodes);
          assert.equal(again.edges, recovered.edges);
          recovered.nodes[0].data.content = '用户已编辑';
          assert.equal(
            recoverGenerationTasks(
              recovered.nodes.slice(0, 2),
              recovered.edges,
              [result],
              () => 400,
            ).nodes.length,
            2,
          );
          assert.equal(
            recoverGenerationTasks(recovered.nodes, recovered.edges, [result], () => 400).nodes[0]
              .data.content,
            '用户已编辑',
          );
          // A previously applied failure must not fence off a subsequent resume's terminal state.
          const resumed = recoverGenerationTasks(
            recovered.nodes,
            recovered.edges,
            [{ ...result, status: 'saving' }],
            () => 400,
          );
          assert.equal(resumed.nodes[0].data.generationAppliedTaskId, undefined);
          const finished = recoverGenerationTasks(
            resumed.nodes,
            resumed.edges,
            [{ ...result, status: 'completed', error: null }],
            () => 400,
          );
          assert.equal(finished.nodes[0].data.status, 'ready');
          assert.equal(finished.nodes[0].data.generationStatus, 'completed');
          assert.equal(finished.nodes.length, 4);
          assert.equal(
            generationFeedbackMessage({
              status: 'generating',
              generationStatus: 'queued',
              generationMessage: '模型繁忙，请更换模型或稍后再试',
            }),
            '',
          );
          assert.equal(
            generationFeedbackMessage({
              status: 'failed',
              error: '模型繁忙，请更换模型或稍后再试',
            }),
            '模型繁忙，请更换模型或稍后再试',
          );
          assert.equal(
            generationFeedbackMessage({
              status: 'ready',
              generationStatus: 'failed',
              error: '部分结果失败',
            }),
            '部分结果失败',
          );
        },
      );
    } finally {
      service?.onModuleDestroy();
      await prisma.$disconnect();
      fs.rmSync(storage, { recursive: true, force: true });
      const admin = new PrismaClient({ datasourceUrl: databaseUrl });
      try {
        assert.match(schema, /^generation_test_[a-f0-9]{32}$/);
        await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await admin.$disconnect();
      }
    }
  },
);
