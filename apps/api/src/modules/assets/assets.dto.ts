import {
  AssetHistoryQuerySchema,
  SaveAssetToLibrarySchema,
  UpdateAssetSchema,
} from '@reel/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class SaveAssetToLibraryDto extends createZodDto(SaveAssetToLibrarySchema) {}
export class UpdateAssetDto extends createZodDto(UpdateAssetSchema) {}
export class AssetHistoryQueryDto extends createZodDto(AssetHistoryQuerySchema) {}
export class CanvasAssetUploadQueryDto extends createZodDto(z.object({
  canvasId: z.string().uuid(),
  kind: z.enum(['image', 'video']),
})) {}
