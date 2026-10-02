import {
  CreateAssetFolderSchema,
  ListAssetFoldersQuerySchema,
  UpdateAssetFolderSchema,
} from '@reel/contracts';
import { createZodDto } from 'nestjs-zod';

export class CreateAssetFolderDto extends createZodDto(CreateAssetFolderSchema) {}
export class UpdateAssetFolderDto extends createZodDto(UpdateAssetFolderSchema) {}
export class ListAssetFoldersQueryDto extends createZodDto(ListAssetFoldersQuerySchema) {}
