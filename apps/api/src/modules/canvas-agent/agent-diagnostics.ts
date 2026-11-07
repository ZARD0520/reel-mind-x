import { Logger } from '@nestjs/common';

const logger = new Logger('CanvasAgentDiagnostics');
type LogSink = Pick<Logger, 'log' | 'warn' | 'error'>;

export function diagnosticEndpoint(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch { return '[invalid URL]'; }
}

/** Diagnostics must never dump environment values, request bodies or provider bodies. */
export function redactDiagnosticText(value: string) {
  let text = value;
  for (const [name, secret] of Object.entries(process.env)) {
    if (secret && secret.length >= 4 && /KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL|REDIS_URL/i.test(name)) text = text.split(secret).join('[redacted]');
  }
  return text
    .replace(/\bBearer\s+[^\s"',;}]+/gi, 'Bearer [redacted]')
    .replace(/((?:api[_-]?key|token|secret|password|authorization)["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, '$1[redacted]')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, url => diagnosticEndpoint(url) ?? '[redacted URL]')
    .slice(0, 1000);
}

export function diagnosticError(error: unknown): Record<string, unknown> {
  const value = (error && typeof error === 'object' ? error : {}) as {
    name?: string; code?: string | number; status?: number; statusCode?: number; message?: string; stack?: string;
    cause?: { name?: string; code?: string; message?: string; model?: string; maxTokens?: number; cause?: { code?: string } };
    meta?: { table?: string; column?: string; modelName?: string; code?: string };
    issues?: Array<{ code?: string; path?: unknown[] }>;
  };
  const result: Record<string, unknown> = { name: value.name ?? 'Error', code: value.code, status: value.status ?? value.statusCode };
  const message = typeof value.message === 'string' ? value.message : typeof error === 'string' ? error : 'Unknown error';
  if (typeof value.code === 'string' && /^P\d{4}$/.test(value.code)) {
    // Prisma messages contain invocation arguments (including user content).
    result.message = 'Database operation failed';
    result.database = value.meta ? Object.fromEntries(['table', 'column', 'modelName', 'code'].flatMap(key => {
      const item = value.meta?.[key as keyof typeof value.meta];
      return typeof item === 'string' && /^[\w.\-" ]{1,150}$/.test(item) ? [[key, item]] : [];
    })) : undefined;
  } else if (Array.isArray(value.issues)) {
    result.message = 'Schema validation failed';
    result.issues = value.issues.slice(0, 12).map(issue => ({ code: issue.code, path: issue.path }));
  } else if (value.code === 'INVALID_PLAN') {
    result.message = 'Planner did not produce a valid plan';
  } else if (value.name === 'LlmError' && /GLM API 调用失败/.test(message)) {
    // Extract only the upstream error code/message, never log its full response.
    result.message = 'Model provider rejected the request';
    try {
      const body = JSON.parse(message.slice(message.indexOf(':') + 1));
      const upstream = body.error;
      if (typeof upstream?.code === 'string' || typeof upstream?.code === 'number') result.providerCode = upstream.code;
      if (typeof upstream?.message === 'string') result.providerMessage = redactDiagnosticText(upstream.message);
    } catch { /* The HTTP status still identifies an HTML/non-JSON gateway error. */ }
  } else result.message = redactDiagnosticText(message);
  if (value.cause) result.cause = {
    name: value.cause.name, code: value.cause.code ?? value.cause.cause?.code,
    message: value.cause.message ? redactDiagnosticText(value.cause.message) : undefined,
    model: value.cause.model, maxTokens: value.cause.maxTokens,
  };
  // Keep call sites, excluding the first line that repeats the raw error text.
  if (typeof value.stack === 'string') result.frames = value.stack.split('\n').filter(line => /^\s+at\s/.test(line)).slice(0, 8).map(redactDiagnosticText);
  return result;
}

export function createAgentDiagnostics(context: { requestId?: string | null; canvasId: string; conversationId: string; runId?: string }, sink: LogSink = logger) {
  const started = Date.now();
  let phase = 'start';
  const write = (level: keyof LogSink, event: string, fields: Record<string, unknown>) => sink[level](JSON.stringify({
    event, ...context, phase, elapsedMs: Date.now() - started, pid: process.pid, ...fields,
  }));
  return {
    stage(next: string, fields: Record<string, unknown> = {}) { phase = next; write('log', 'agent.stage', fields); },
    event(event: string, fields: Record<string, unknown> = {}) { write('log', event, fields); },
    failure(error: unknown, event = 'agent.failed', fields: Record<string, unknown> = {}) { write('error', event, { ...fields, error: diagnosticError(error) }); },
  };
}
export type AgentDiagnostics = ReturnType<typeof createAgentDiagnostics>;
