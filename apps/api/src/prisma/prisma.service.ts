import { Injectable, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@reel/db';

/**
 * 可注入的 Prisma client。数据访问只在 service 层使用。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
