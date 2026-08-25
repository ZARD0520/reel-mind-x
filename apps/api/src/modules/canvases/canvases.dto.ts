import { CreateCanvasSchema, UpdateCanvasSchema } from '@reel/contracts';
import { createZodDto } from 'nestjs-zod';

export class CreateCanvasDto extends createZodDto(CreateCanvasSchema) {}
export class UpdateCanvasDto extends createZodDto(UpdateCanvasSchema) {}
