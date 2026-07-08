import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3888),
  DATABASE_URL: z.string().url(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  STORAGE_DIR: z.string().default('storage'),
  PUBLIC_URL: z.string().url().default('http://localhost:3888'),
  SESSION_SECRET: z.string().min(16).default('dev-session-secret-change-me'),
  AUTH_COOKIE_NAME: z.string().default('reel_session'),
  AUTH_SESSION_DAYS: z.coerce.number().int().positive().default(7),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  GLM_API_KEY: z.string().min(1),
  GLM_BASE_URL: z.string().url().default('https://open.bigmodel.cn/api/paas/v4'),
  GLM_MODEL: z.string().default('glm-4-flash'),
  GLM_IMAGE_MODEL: z.string().default('cogview-3-flash'),
  GLM_VIDEO_MODEL: z.string().default('cogvideox-flash'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('Environment validation failed:', parsed.error.format());
    process.exit(1);
  }
  return parsed.data;
}
