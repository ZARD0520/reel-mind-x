import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Asset } from '@reel/contracts';
import { randomUUID } from 'crypto';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { AssetsService } from './assets.service';

@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          // Multer storage 在装饰阶段构造，拿不到 DI，直接读 env 解析目录。
          const dir = path.resolve(process.env.STORAGE_DIR || 'storage', 'uploads');
          fs.mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          cb(null, `${randomUUID()}${path.extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB
    }),
  )
  async upload(@UploadedFile() file?: Express.Multer.File): Promise<Asset> {
    if (!file) throw new BadRequestException('缺少上传文件字段 file');
    return this.assets.createFromUpload(file);
  }

  @Get()
  list(): Promise<Asset[]> {
    return this.assets.list();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Asset> {
    return this.assets.findOne(id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.assets.remove(id);
  }
}
