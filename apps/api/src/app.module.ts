import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ZodValidationPipe } from 'nestjs-zod';
import { validateEnv, type Env } from './config/env';
import { AiGenExceptionFilter } from './filters/ai-gen-exception.filter';
import { LlmExceptionFilter } from './filters/llm-exception.filter';
import { AgentModule } from './modules/agent/agent.module';
import { AiGenMediaModule } from './modules/ai-gen-media/ai-gen-media.module';
import { AiMixModule } from './modules/ai-mix/ai-mix.module';
import { AssetsModule } from './modules/assets/assets.module';
import { AuthModule } from './modules/auth/auth.module';
import { FilesModule } from './modules/files/files.module';
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
    AuthModule,
    LlmModule,
    AgentModule,
    AiMixModule,
    AssetsModule,
    FilesModule,
    ProjectsModule,
    RenderModule,
    TextGenModule,
    AiGenMediaModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: LlmExceptionFilter },
    { provide: APP_FILTER, useClass: AiGenExceptionFilter },
  ],
})
export class AppModule {}
