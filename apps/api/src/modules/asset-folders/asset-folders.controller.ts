import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Asset, AssetFolder } from '@reel/contracts';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  CreateAssetFolderDto,
  ListAssetFoldersQueryDto,
  UpdateAssetFolderDto,
} from './asset-folders.dto';
import { AssetFoldersService } from './asset-folders.service';

@Controller('asset-folders')
@UseGuards(AuthGuard)
export class AssetFoldersController {
  constructor(private readonly assetFolders: AssetFoldersService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAssetFolderDto): Promise<AssetFolder> {
    return this.assetFolders.create(user.id, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListAssetFoldersQueryDto,
  ): Promise<AssetFolder[]> {
    return this.assetFolders.list(user.id, query.scope);
  }

  @Get(':id/assets')
  listAssets(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Asset[]> {
    return this.assetFolders.listAssets(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssetFolderDto,
  ): Promise<AssetFolder> {
    return this.assetFolders.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.assetFolders.remove(user.id, id);
  }
}
