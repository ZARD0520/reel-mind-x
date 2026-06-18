import { z } from 'zod';

/**
 * 启动配置：用 Zod 校验 env，失败立即退出（fail fast）。
 * 全应用只从这里取配置，禁止散落直接读 process.env。
 */
const envSchema = z.object({
  PORT: z.coerce.number().default(3888),
  DATABASE_URL: z.string().url(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  /** 上传文件存储根目录（相对 api 工作目录或绝对路径） */
  STORAGE_DIR: z.string().default('storage'),
  /** 静态资源对外基地址，用于拼 Asset.url */
  PUBLIC_URL: z.string().url().default('http://localhost:3888'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('❌ 环境变量校验失败:', parsed.error.format());
    process.exit(1);
  }
  return parsed.data;
}
