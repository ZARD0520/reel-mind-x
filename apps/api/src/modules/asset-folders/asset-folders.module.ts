import { Module } from '@nestjs/common';
import { AssetFoldersController } from './asset-folders.controller';
import { AssetFoldersService } from './asset-folders.service';

@Module({
  controllers: [AssetFoldersController],
  providers: [AssetFoldersService],
})
export class AssetFoldersModule {}
