/** AI 图像/视频生成队列与任务名 */
export enum QueueNames {
  AI_GEN_MEDIA = 'ai-gen-media',
  AI_GEN_MEDIA_DLQ = 'ai-gen-media-dlq',
}

export const JobNames = {
  GENERATE_IMAGE: 'generate-image',
  GENERATE_VIDEO: 'generate-video',
} as const;

/** 图像生成 job payload */
export interface GenerateImageJobPayload {
  userId: string;
  projectId: string;
  assetId: string;
  prompt: string;
  size: string;
}

/** 视频生成 job payload */
export interface GenerateVideoJobPayload {
  userId: string;
  projectId: string;
  assetId: string;
  prompt: string;
  size: string;
}
