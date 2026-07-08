import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import type { Asset } from '@reel/contracts';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { AiGenMediaService } from './ai-gen-media.service';
import { GenerateImageDto, GenerateVideoDto } from './ai-gen-media.dto';

@Controller('ai-gen-media')
@UseGuards(AuthGuard)
export class AiGenMediaController {
  constructor(private readonly service: AiGenMediaService) {}

  @Post('image')
  async generateImage(
    @CurrentUser() user: AuthUser,
    @Body() dto: GenerateImageDto,
  ): Promise<Asset> {
    return this.service.generateImage(user.id, dto);
  }

  @Post('video')
  async generateVideo(
    @CurrentUser() user: AuthUser,
    @Body() dto: GenerateVideoDto,
  ): Promise<Asset> {
    return this.service.generateVideo(user.id, dto);
  }
}
