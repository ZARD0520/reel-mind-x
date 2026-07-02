import { Body, Controller, Post } from '@nestjs/common';
import type { Asset } from '@reel/contracts';
import { AiGenMediaService } from './ai-gen-media.service';
import { GenerateImageDto, GenerateVideoDto } from './ai-gen-media.dto';

/**
 * AI 图像/视频生成接口。
 * 返回 status=generating 的 Asset 占位符，前端轮询该 Asset 直到 ready/failed。
 */
@Controller('ai-gen-media')
export class AiGenMediaController {
  constructor(private readonly service: AiGenMediaService) {}

  @Post('image')
  async generateImage(@Body() dto: GenerateImageDto): Promise<Asset> {
    return this.service.generateImage(dto);
  }

  @Post('video')
  async generateVideo(@Body() dto: GenerateVideoDto): Promise<Asset> {
    return this.service.generateVideo(dto);
  }
}
