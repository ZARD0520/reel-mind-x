const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require('reflect-metadata');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, experimentalDecorators: true, emitDecoratorMetadata: true }, fileName: filename,
}).outputText, filename);
const { TranscriptionService, TRANSCRIPTION_MAX_BYTES } = require('../src/modules/transcription/transcription.service.ts');
const { validateEnv } = require('../src/config/env.ts');
const model = 'XingChenAGI/XingChenASR-V3.2-Ultra';
const config = { get: key => ({ SILICONFLOW_API_KEY: 'fixture-key', SILICONFLOW_BASE_URL: 'https://api.siliconflow.cn/v1/', SILICONFLOW_ASR_MODEL: model })[key] };
const file = { buffer: Buffer.from('fixture recording'), mimetype: 'audio/webm;codecs=opus' };

test('transcription uses the requested default model and multipart audio without exposing the key', async () => {
  assert.equal(validateEnv({ DATABASE_URL: 'postgresql://localhost/test', GLM_API_KEY: 'fixture' }).SILICONFLOW_ASR_MODEL, model);
  const original = global.fetch;
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.siliconflow.cn/v1/audio/transcriptions');
    assert.equal(options.headers.Authorization, 'Bearer fixture-key');
    assert.equal(options.headers['Content-Type'], undefined);
    assert.equal(options.body.get('model'), model);
    assert.equal(options.body.get('file').name, 'recording.webm');
    assert.equal(await options.body.get('file').text(), 'fixture recording');
    assert.ok(options.signal);
    return Response.json({ text: '  生成一个小狗的故事  ' });
  };
  try {
    assert.deepEqual(await new TranscriptionService(config).transcribe(file), { text: '生成一个小狗的故事' });
    for (const status of [401, 400, 429, 503]) {
      global.fetch = async () => new Response('fixture-key secret', { status });
      await assert.rejects(new TranscriptionService(config).transcribe(file), error => !error.message.includes('fixture-key'));
    }
    global.fetch = async () => Response.json({ text: 42 });
    await assert.rejects(new TranscriptionService(config).transcribe(file), /结果异常/);
    global.fetch = async () => { throw new Error('network fixture-key'); };
    await assert.rejects(new TranscriptionService(config).transcribe(file), /网络异常/);
  } finally { global.fetch = original; }
});

test('invalid, empty, oversized audio and missing configuration are rejected before contacting SiliconFlow', async () => {
  const original = global.fetch;
  global.fetch = async () => { assert.fail('Unexpected provider request'); };
  try {
    const service = new TranscriptionService(config);
    for (const input of [undefined, { ...file, buffer: Buffer.alloc(0) }, { ...file, mimetype: 'image/png' }, { ...file, buffer: Buffer.alloc(TRANSCRIPTION_MAX_BYTES + 1) }]) {
      await assert.rejects(service.transcribe(input), error => error.getStatus() === 400);
    }
    await assert.rejects(new TranscriptionService({ get: () => undefined }).transcribe(file), error => error.getStatus() === 503);
  } finally { global.fetch = original; }
});

test('HTTP transcription requires authentication and enforces multipart file limits', async () => {
  const { Module } = require('@nestjs/common');
  const { NestFactory } = require('@nestjs/core');
  const { AuthService } = require('../src/modules/auth/auth.service.ts');
  const { TranscriptionController } = require('../src/modules/transcription/transcription.controller.ts');
  let calls = 0;
  class Fixture {}
  Module({ controllers: [TranscriptionController], providers: [
    { provide: AuthService, useValue: { cookieName: 'session', getSessionUser: async token => token === 'fixture' ? { id: 'user' } : null } },
    { provide: TranscriptionService, useValue: { transcribe: async input => { calls++; assert.equal(input.buffer.toString(), 'voice'); return { text: '识别结果' }; } } },
  ] })(Fixture);
  const app = await NestFactory.create(Fixture, { logger: false, abortOnError: false });
  await app.listen(0, '127.0.0.1');
  try {
    const endpoint = `${await app.getUrl()}/audio/transcriptions`;
    const form = size => { const body = new FormData(); body.append('file', new Blob([size ? new Uint8Array(size) : 'voice'], { type: 'audio/webm' }), 'voice.webm'); return body; };
    assert.equal((await fetch(endpoint, { method: 'POST', body: form() })).status, 401);
    assert.equal(calls, 0);
    const response = await fetch(endpoint, { method: 'POST', headers: { Cookie: 'session=fixture' }, body: form() });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { text: '识别结果' });
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { Cookie: 'session=fixture' }, body: form(TRANSCRIPTION_MAX_BYTES + 1) })).status, 413);
    assert.equal(calls, 1);
  } finally { await app.close(); }
});
