import { createZodDto } from 'nestjs-zod';
import { GenerateImageSchema, GenerateVideoSchema } from '@reel/contracts';

export class GenerateImageDto extends createZodDto(GenerateImageSchema) {}
export class GenerateVideoDto extends createZodDto(GenerateVideoSchema) {}
