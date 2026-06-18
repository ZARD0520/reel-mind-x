import { createZodDto } from 'nestjs-zod';
import { CreateProjectSchema, UpdateProjectSchema } from '@reel/contracts';

// DTO 复用 packages/contracts 的 Zod schema，前后端同一份校验。
export class CreateProjectDto extends createZodDto(CreateProjectSchema) {}
export class UpdateProjectDto extends createZodDto(UpdateProjectSchema) {}
