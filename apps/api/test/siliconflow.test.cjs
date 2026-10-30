const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SiliconFlowAiGenProvider, AiGenError } = require('../../../packages/ai-gen/dist');
const { CreateGenerationTaskSchema, GenerateImageSchema, KOLORS_IMAGE_SIZES } = require('../../../packages/contracts/dist');
const model = 'Kwai-Kolors/Kolors';

test('Kolors contracts accept documented dimensions and reject incompatible dimensions', () => {
  const base = { requestId: '00000000-0000-4000-8000-000000000001', canvasId: '00000000-0000-4000-8000-000000000002', kind: 'image', prompt: 'test', model };
  for (const size of KOLORS_IMAGE_SIZES) {
    assert.equal(CreateGenerationTaskSchema.parse({ ...base, size }).size, size);
    assert.equal(GenerateImageSchema.parse({ ...base, size }).size, size);
  }
  for (const schema of [CreateGenerationTaskSchema, GenerateImageSchema]) {
    assert.equal(schema.safeParse({ ...base, size: '1344x768' }).success, false);
    assert.equal(schema.safeParse({ ...base, model: 'cogview-3-flash', size: '513x512' }).success, false);
  }
});

test('Kolors allows one owned image asset reference; other image models keep text-only inputs', () => {
  const assetId = '00000000-0000-4000-8000-000000000003';
  const base = { requestId: '00000000-0000-4000-8000-000000000001', canvasId: '00000000-0000-4000-8000-000000000002', kind: 'image', prompt: 'test', model,
    imageAssetIds: [assetId], references: [{ kind: 'image', name: 'Photo', assetId }] };
  assert.equal(CreateGenerationTaskSchema.safeParse(base).success, true);
  assert.deepEqual(GenerateImageSchema.parse(base).imageAssetIds, [assetId]);
  for (const patch of [
    { model: 'cogview-3-flash' },
    { imageAssetIds: [assetId, '00000000-0000-4000-8000-000000000004'] },
    { imageAssetIds: [] },
    { references: [{ kind: 'image', name: 'Untrusted URL', url: 'https://invalid.test/image.png' }] },
    { references: [{ kind: 'audio', name: 'Audio' }] },
  ]) assert.equal(CreateGenerationTaskSchema.safeParse({ ...base, ...patch }).success, false);
});

test('SiliconFlow sends its own request format, parses images, and preserves failure certainty', async () => {
  const provider = new SiliconFlowAiGenProvider({ apiKey: 'fixture' });
  const original = global.fetch;
  const signal = new AbortController().signal;
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.siliconflow.cn/v1/images/generations');
    assert.equal(options.headers.Authorization, 'Bearer fixture');
    assert.equal(options.signal, signal);
    assert.deepEqual(JSON.parse(options.body), { model, prompt: 'test', image_size: '720x1280', num_inference_steps: 20, guidance_scale: 7.5 });
    return Response.json({ images: [{ url: 'https://fixture/image.png' }] });
  };
  try {
    const result = await provider.generateImage({ prompt: 'test', size: '720x1280', quality: 'hd', signal });
    assert.deepEqual(result, { url: 'https://fixture/image.png', type: 'image', model, prompt: 'test' });
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.image, 'data:image/png;base64,fixture');
      assert.equal(body.prompt, 'watercolor');
      assert.equal(body.image_size, '1024x1024');
      assert.equal(body.image_url, undefined);
      return Response.json({ images: [{ url: 'https://fixture/edited.png' }] });
    };
    await provider.generateImage({ prompt: 'watercolor', imageUrls: ['data:image/png;base64,fixture'] });
    await assert.rejects(provider.generateImage({ prompt: 'test', imageUrls: ['a', 'b'] }), error => error.outcome === 'rejected');
    for (const [status, outcome] of [[401, 'rejected'], [429, 'rejected'], [503, 'unknown']]) {
      global.fetch = async () => new Response('secret provider response', { status });
      await assert.rejects(provider.generateImage({ prompt: 'test' }), error => error instanceof AiGenError && error.status === status && error.outcome === outcome && !error.message.includes('secret'));
    }
    global.fetch = async () => Response.json({ data: [{ url: 'wrong response shape' }] });
    await assert.rejects(provider.generateImage({ prompt: 'test' }), /images\[0\].url/);
    global.fetch = async () => { throw new Error('network failure'); };
    await assert.rejects(provider.generateImage({ prompt: 'test' }), error => error.outcome === 'unknown');
    await assert.rejects(new SiliconFlowAiGenProvider({ apiKey: '' }).generateImage({ prompt: 'test' }), error => error.outcome === 'rejected');
  } finally { global.fetch = original; }
});
