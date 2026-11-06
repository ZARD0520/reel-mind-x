import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CanvasChatReferenceSchema = z.object({
  id: z.string().min(1).max(100),
  kind: z.enum(['text', 'image', 'video', 'audio']),
  title: z.string().trim().min(1).max(200),
  content: z.string().max(12000).optional(),
  prompt: z.string().max(2000).optional(),
  assetId: z.string().uuid().optional(),
  url: z.string().max(2000).optional(),
  description: z.string().max(2000).optional(),
});
export type CanvasChatReference = z.infer<typeof CanvasChatReferenceSchema>;

export class SendCanvasMessageDto extends createZodDto(z.object({
  content: z.string().trim().min(1).max(20000),
  references: z.array(CanvasChatReferenceSchema).max(8).default([]),
  selectedNodeIds: z.array(z.string().min(1).max(100)).max(100).default([]),
  requestId: z.string().uuid().optional(),
  resume: z.boolean().default(false),
})) {}

export class RenameCanvasConversationDto extends createZodDto(z.object({
  title: z.string().trim().min(1).max(80),
})) {}
