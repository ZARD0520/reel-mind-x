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
  /** 导出成片子目录（相对 STORAGE_DIR），通过 /static/<此值> 暴露 */
  EXPORT_SUBDIR: z.string().default('exports'),
  /** 静态资源对外基地址，用于拼 Asset.url */
  PUBLIC_URL: z.string().url().default('http://localhost:3888'),
  /** 智谱 API 密钥（文本/图像/视频生成共用） */
  GLM_API_KEY: z.string().min(1),
  /** 智谱 API 基地址（可选，默认智谱开放平台 v4） */
  GLM_BASE_URL: z
    .string()
    .url()
    .default('https://open.bigmodel.cn/api/paas/v4'),
  /** 默认文本模型 */
  GLM_MODEL: z.string().default('glm-4-flash'),
  /** 默认图像模型 */
  GLM_IMAGE_MODEL: z.string().default('cogview-3-flash'),
  /** 默认视频模型 */
  GLM_VIDEO_MODEL: z.string().default('cogvideox-flash'),
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
