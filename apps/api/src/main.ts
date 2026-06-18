import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import type { Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // 全局校验用 nestjs-zod 的 ZodValidationPipe（在 AppModule 注册）。
  // 优雅关闭：让在途 BullMQ 任务跑完，触发 onModuleDestroy。
  app.enableShutdownHooks();

  const config = app.get(ConfigService<Env, true>);
  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  console.log(`🚀 API 运行在 http://localhost:${port}`);
}

void bootstrap();
