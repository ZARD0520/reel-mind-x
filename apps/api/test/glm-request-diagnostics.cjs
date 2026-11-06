// Opt-in diagnostic: prints response metadata only, never credentials or prompts.
const tool = { type: 'function', function: { name: 'get_canvas_context', description: 'Read current canvas', parameters: { type: 'object', properties: {}, required: [] } } };
const variants = [
  ['text-node', { stream: false }],
  ['stream-text', { stream: true }],
  ['tools-default-thinking', { stream: true, tools: [tool], tool_choice: 'auto' }],
  ['tools-disabled-thinking', { stream: true, tools: [tool], tool_choice: 'auto', thinking: { type: 'disabled' } }],
  ['tools-nonstream', { stream: false, tools: [tool], tool_choice: 'auto' }],
];
(async () => {
  if (!process.env.GLM_API_KEY) throw new Error('GLM_API_KEY is required');
  const endpoint = `${process.env.GLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4'}/chat/completions`;
  const model = process.env.GLM_DIAGNOSTIC_MODEL || 'glm-4.6v-flash';
  console.log(JSON.stringify({ endpoint, model }));
  for (const [variant, options] of variants) {
    if (process.env.GLM_DIAGNOSTIC_VARIANT && variant !== process.env.GLM_DIAGNOSTIC_VARIANT) continue;
    const started = Date.now();
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GLM_API_KEY}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: options.tools ? '请调用get_canvas_context读取画布' : '请回复你好' }], max_tokens: 512, ...options }),
        signal: AbortSignal.timeout(30000),
      });
      const body = await response.text();
      let error;
      try { error = JSON.parse(body).error; } catch {}
      console.log(JSON.stringify({ variant, status: response.status, elapsedMs: Date.now() - started, error, hasToolCalls: body.includes('tool_calls'), contentType: response.headers.get('content-type') }));
    } catch (error) { console.log(JSON.stringify({ variant, elapsedMs: Date.now() - started, error: error.message })); }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
