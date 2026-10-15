import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CanvasChatReferenceSchema = z.object({
  id: z.string().min(1).max(100),
  kind: z.enum(['text', 'image', 'video']),
  title: z.string().trim().min(1).max(200),
  content: z.string().max(12000).optional(),
  prompt: z.string().max(2000).optional(),
  assetId: z.string().uuid().optional(),
  description: z.string().max(2000).optional(),
});
export type CanvasChatReference = z.infer<typeof CanvasChatReferenceSchema>;

export class SendCanvasMessageDto extends createZodDto(z.object({
  content: z.string().trim().min(1).max(20000),
  references: z.array(CanvasChatReferenceSchema).max(8).default([]),
})) {}

export class RenameCanvasConversationDto extends createZodDto(z.object({
  title: z.string().trim().min(1).max(80),
})) {}
