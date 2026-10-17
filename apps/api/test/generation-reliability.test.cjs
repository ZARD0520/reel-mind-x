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
const { AssetFoldersService } = require('../src/modules/asset-folders/asset-folders.service.ts');
const repo = path.resolve(__dirname, '../../..');

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
          STORAGE_DIR: storage,
        })[key],
    };
    let service;
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
      execFileSync('pnpm', ['--filter', '@reel/db', 'exec', 'prisma', 'migrate', 'deploy'], {
        cwd: repo,
        env: { ...process.env, DATABASE_URL: url.toString() },
        stdio: 'pipe',
      });
      user = await prisma.user.create({
        data: { name: 'Generation reliability fixture', email: `${schema}@invalid.test` },
      });
      canvas = await prisma.canvas.create({
        data: { userId: user.id, name: 'Generation reliability fixture' },
      });
      service = new GenerationTasksService(prisma, config, queue);

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
          service = new GenerationTasksService(prisma, config, queue); // new process, same durable storage
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
          const offline = new GenerationTasksService(prisma, config, {
            add: async () => {
              throw new Error('Redis offline');
            },
          });
          const task = await offline.create(user.id, {
            requestId: randomUUID(),
            canvasId: canvas.id,
            nodeId: randomUUID(),
            kind: 'text',
            prompt: '排队',
          });
          await offline.dispatchDue();
          const recovery = new GenerationTasksService(prisma, config, queue);
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
          assert.equal(recovered.nodes.length, 3);
          assert.equal(recovered.edges.length, 3);
          assert.equal(recovered.nodes[0].data.content, '测试结果');
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
          assert.equal(finished.nodes.length, 3);
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
