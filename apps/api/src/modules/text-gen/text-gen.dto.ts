import { createZodDto } from 'nestjs-zod';
import { GenerateTextSchema } from '@reel/contracts';

/**
 * DTO 复用 packages/contracts 的 Zod schema，前后端同一份校验。
 */
export class GenerateTextDto extends createZodDto(GenerateTextSchema) {}
