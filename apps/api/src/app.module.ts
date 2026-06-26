import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ZodValidationPipe } from 'nestjs-zod';
import * as path from 'path';
import { validateEnv, type Env } from './config/env';
import { AgentModule } from './modules/agent/agent.module';
import { AiMixModule } from './modules/ai-mix/ai-mix.module';
import { AssetsModule } from './modules/assets/assets.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { RenderModule } from './modules/render/render.module';
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
    AgentModule,
    AiMixModule,
    AssetsModule,
    ProjectsModule,
    RenderModule,
  ],
  // 全局 Zod 校验：createZodDto 的 DTO 自动按 contracts schema 校验。
  providers: [{ provide: APP_PIPE, useClass: ZodValidationPipe }],
})
export class AppModule {}
