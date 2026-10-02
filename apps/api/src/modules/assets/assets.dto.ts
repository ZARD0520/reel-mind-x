import { SaveAssetToLibrarySchema, UpdateAssetSchema } from '@reel/contracts';
import { createZodDto } from 'nestjs-zod';

export class SaveAssetToLibraryDto extends createZodDto(SaveAssetToLibrarySchema) {}
export class UpdateAssetDto extends createZodDto(UpdateAssetSchema) {}
