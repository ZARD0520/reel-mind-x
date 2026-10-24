import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(AuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}
  @Get('overview') overview() {
    return this.admin.overview();
  }
  @Get('users') users(@Query() query: unknown) {
    return this.admin.users(query);
  }
  @Patch('users/:id') updateUser(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.admin.updateUser(user.id, id, body);
  }
  @Post('users/:id/credits') adjust(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.admin.adjust(user.id, id, body);
  }
  @Get('ledger') ledger(@Query() query: unknown) {
    return this.admin.ledger(query);
  }
  @Get('tasks') tasks(@Query() query: unknown) {
    return this.admin.tasks(query);
  }
  @Get('projects') projects(@Query() query: unknown) {
    return this.admin.projects(query);
  }
  @Get('assets') assets(@Query() query: unknown) {
    return this.admin.assets(query);
  }
  @Get('assets/:id') asset(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.asset(id);
  }
  @Get('prices') prices() {
    return this.admin.prices();
  }
  @Post('prices') savePrice(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.admin.savePrice(user.id, body);
  }
  @Get('settings') settings() {
    return this.admin.settings();
  }
  @Patch('settings') saveSettings(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.admin.saveSettings(user.id, body);
  }
  @Get('audits') audits(@Query() query: unknown) {
    return this.admin.audits(query);
  }
}
