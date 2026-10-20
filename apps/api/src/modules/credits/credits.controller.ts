import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { PageQuerySchema } from '@reel/contracts';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditsService } from './credits.service';

@Controller('credits')
@UseGuards(AuthGuard)
export class CreditsController {
  constructor(
    private readonly credits: CreditsService,
    private readonly prisma: PrismaService,
  ) {}
  @Get('balance') balance(@CurrentUser() user: AuthUser) {
    return this.credits.balance(user.id);
  }
  @Post('quote') quote(@Body() body: unknown) {
    return this.credits.quote(body);
  }
  @Get('ledger') async ledger(@CurrentUser() user: AuthUser, @Query() raw: unknown) {
    const { page, pageSize } = PageQuerySchema.parse(raw);
    await this.credits.balance(user.id);
    const where = { userId: user.id };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.creditEntry.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.creditEntry.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
}
