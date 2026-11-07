import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Env } from './env';
import { diagnosticEndpoint } from '../modules/canvas-agent/agent-diagnostics';
import { FALLBACK_AGENT_MODEL, PRIMARY_AGENT_MODEL } from '../modules/canvas-agent/model-retry';

export function logRuntimeDiagnostics(config: ConfigService<Env, true>) {
  const cwd = process.cwd();
  const database = config.get('DATABASE_URL', { infer: true });
  let databaseHost: string | undefined;
  try { databaseHost = new URL(database).host; } catch { /* Env validation reports invalid URLs. */ }
  new Logger('RuntimeDiagnostics').log(JSON.stringify({
    event: 'agent.runtime', pid: process.pid, node: process.version, cwd,
    nodeEnv: process.env.NODE_ENV ?? 'unset', pm2Instance: process.env.NODE_APP_INSTANCE,
    defaultEnvFile: path.join(cwd, '.env'), defaultEnvFileExists: existsSync(path.join(cwd, '.env')),
    productionEnvFileExists: existsSync(path.join(cwd, '.env.production')),
    envNote: 'API loads cwd/.env by default; existing process environment takes precedence. .env.production is not loaded automatically.',
    glmKeyConfigured: !!config.get('GLM_API_KEY', { infer: true })?.trim(),
    glmBaseUrl: diagnosticEndpoint(config.get('GLM_BASE_URL', { infer: true })),
    agentModel: PRIMARY_AGENT_MODEL, fallbackModel: FALLBACK_AGENT_MODEL,
    databaseConfigured: !!database, databaseHost,
  }));
}
