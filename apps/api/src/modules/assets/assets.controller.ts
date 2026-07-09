import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Asset } from '@reel/contracts';
import { randomUUID } from 'crypto';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest, AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { AssetsService } from './assets.service';

@Controller('assets')
@UseGuards(AuthGuard)
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, _file, cb) => {
          const userId = (req as unknown as AuthenticatedRequest).user.id;
          const dir = path.resolve(process.env.STORAGE_DIR || 'storage', 'users', userId, 'uploads');
          fs.mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          cb(null, `${randomUUID()}${path.extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 1024 * 1024 * 1024 },
    }),
  )
  async upload(
    @CurrentUser() user: AuthUser,
    @Query('projectId', new ParseUUIDPipe()) projectId: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<Asset> {
    if (!file) throw new BadRequestException('Missing upload field: file');
    return this.assets.createFromUpload(user.id, projectId, file);
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('projectId', new ParseUUIDPipe()) projectId: string,
  ): Promise<Asset[]> {
    return this.assets.list(user.id, projectId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Asset> {
    return this.assets.findOne(user.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.assets.remove(user.id, id);
  }
}
