import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class SendCanvasMessageDto extends createZodDto(z.object({
  content: z.string().trim().min(1).max(20000),
})) {}

export class RenameCanvasConversationDto extends createZodDto(z.object({
  title: z.string().trim().min(1).max(80),
})) {}
