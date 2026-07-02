import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ZodValidationPipe } from 'nestjs-zod';
import * as path from 'path';
import { validateEnv, type Env } from './config/env';
import { AiGenExceptionFilter } from './filters/ai-gen-exception.filter';
import { LlmExceptionFilter } from './filters/llm-exception.filter';
import { AgentModule } from './modules/agent/agent.module';
import { AiGenMediaModule } from './modules/ai-gen-media/ai-gen-media.module';
import { AiMixModule } from './modules/ai-mix/ai-mix.module';
import { AssetsModule } from './modules/assets/assets.module';
import { LlmModule } from './modules/llm/llm.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { RenderModule } from './modules/render/render.module';
import { TextGenModule } from './modules/text-gen/text-gen.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    // 本地开发静态文件服务：把 storage/ 目录暴露为 /static
    ServeStaticModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => [
        {
          rootPath: path.resolve(config.get('STORAGE_DIR', { infer: true })),
          serveRoot: '/static',
          serveStaticOptions: { index: false },
        },
      ],
    }),
    // Redis 连接异步注入，不写死。
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: {
          host: config.get('REDIS_HOST', { infer: true }),
          port: config.get('REDIS_PORT', { infer: true }),
        },
      }),
    }),
    PrismaModule,
    LlmModule, // 全局 LLM 抽象层
    AgentModule,
    AiMixModule,
    AssetsModule,
    ProjectsModule,
    RenderModule,
    TextGenModule, // AI 文本生成
    AiGenMediaModule, // AI 图像/视频生成
  ],
  // 全局 Zod 校验：createZodDto 的 DTO 自动按 contracts schema 校验。
  // 全局异常过滤器：LlmError / AiGenError → 友好的 HTTP 响应。
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: LlmExceptionFilter },
    { provide: APP_FILTER, useClass: AiGenExceptionFilter },
  ],
})
export class AppModule {}
