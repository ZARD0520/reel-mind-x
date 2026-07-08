import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import type { Env } from '../../config/env';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthUser, FileResponse } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('files')
@UseGuards(AuthGuard)
export class FilesController {
  constructor(private readonly config: ConfigService<Env, true>) {}

  @Get('users/:userId/:scope/:filename')
  async getUserFile(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Param('scope') scope: string,
    @Param('filename') filename: string,
    @Res() res: FileResponse,
  ): Promise<void> {
    if (user.id !== userId) throw new ForbiddenException('File access denied');
    if (!['uploads', 'exports'].includes(scope)) throw new NotFoundException('File not found');
    if (filename !== path.basename(filename)) throw new NotFoundException('File not found');

    const storageDir = path.resolve(this.config.get('STORAGE_DIR', { infer: true }));
    const filePath = path.join(storageDir, 'users', userId, scope, filename);
    const exists = await fs.promises.stat(filePath).then((stat) => stat.isFile()).catch(() => false);
    if (!exists) throw new NotFoundException('File not found');
    res.sendFile(filePath);
  }
}
