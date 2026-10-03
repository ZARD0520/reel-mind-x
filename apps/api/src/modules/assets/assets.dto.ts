import {
  AssetHistoryQuerySchema,
  SaveAssetToLibrarySchema,
  UpdateAssetSchema,
} from '@reel/contracts';
import { createZodDto } from 'nestjs-zod';

export class SaveAssetToLibraryDto extends createZodDto(SaveAssetToLibrarySchema) {}
export class UpdateAssetDto extends createZodDto(UpdateAssetSchema) {}
export class AssetHistoryQueryDto extends createZodDto(AssetHistoryQuerySchema) {}
