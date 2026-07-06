import { z } from 'zod';

/**
 * 共享契约：Zod 是单一事实来源。
 * schema 定义一次，前后端共享校验 + 用 z.infer 推导类型。
 */

// ───────────────────────── User（示例，保留） ─────────────────────────

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1).max(120),
  createdAt: z.coerce.date(),
});
export type User = z.infer<typeof UserSchema>;

export const CreateUserSchema = UserSchema.pick({ email: true, name: true });
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

// ───────────────────────── 素材库 Asset ─────────────────────────

/** 素材类型 */
export const AssetKindSchema = z.enum(['video', 'image', 'audio']);
export type AssetKind = z.infer<typeof AssetKindSchema>;

/** 素材来源：上传 / AI 生成 */
export const AssetSourceSchema = z.enum(['upload', 'ai']);
export type AssetSource = z.infer<typeof AssetSourceSchema>;

/** 素材就绪状态（AI 生成异步，故有 generating/failed） */
export const AssetStatusSchema = z.enum(['ready', 'generating', 'failed']);
export type AssetStatus = z.infer<typeof AssetStatusSchema>;

/**
 * 素材库条目：可复用的媒体，独立于时间轴。
 * 一个 Asset 可被多个 Clip 引用。
 */
export const AssetSchema = z.object({
  id: z.string().uuid(),
  kind: AssetKindSchema,
  source: AssetSourceSchema,
  status: AssetStatusSchema,
  name: z.string().min(1).max(200),
  /** 媒体访问地址（上传后或 AI 生成完成后填充；generating 时可为空） */
  url: z.string().url().nullable(),
  /** 视频/音频的源时长（帧）。image 为 null */
  durationInFrames: z.number().int().nonnegative().nullable(),
  /** 视频/图片的像素尺寸。audio 为 null */
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  /** AI 生成时的提示词（source=ai 时有意义） */
  prompt: z.string().max(2000).nullable(),
  createdAt: z.coerce.date(),
});
export type Asset = z.infer<typeof AssetSchema>;

// ───────────────────────── 片段属性 Transform ─────────────────────────

/**
 * 片段视觉/音频属性。MVP 可不编辑，结构预留。
 * 视觉值为相对默认的归一化语义，预览与 FFmpeg 两端按同一定义解释。
 */
export const ClipTransformSchema = z.object({
  /** 缩放，1 = 原始大小 */
  scale: z.number().positive().default(1),
  /** 相对画面中心的偏移（像素，基于 project 分辨率） */
  x: z.number().default(0),
  y: z.number().default(0),
  /** 旋转角度（度） */
  rotation: z.number().default(0),
  /** 不透明度 0..1 */
  opacity: z.number().min(0).max(1).default(1),
  /** 音量 0..1（音频/含音轨的视频） */
  volume: z.number().min(0).max(1).default(1),
  /** 播放速率，1 = 原速。改变速率会按源时长重算片段在时间轴的占用长度。 */
  speed: z.number().positive().default(1),
  /** 淡入时长（秒），0 表示无淡入 */
  fadeInDuration: z.number().nonnegative().default(0),
  /** 淡出时长（秒），0 表示无淡出 */
  fadeOutDuration: z.number().nonnegative().default(0),
});
export type ClipTransform = z.infer<typeof ClipTransformSchema>;

// ───────────────────────── 转场效果 Transition ─────────────────────────

/**
 * 转场类型：用 FFmpeg xfade 滤镜实现。
 * 转场发生在「本片段结尾 → 下一片段开头」，两者在时间轴上重叠 duration 秒。
 */
export const TransitionTypeSchema = z.enum([
  // 基础淡化
  'fade',        // 淡入淡出（最通用）
  'fadeblack',   // 经过黑场
  'fadewhite',   // 经过白场
  'dissolve',    // 溶解（像素随机）
  // 擦除（wipe）
  'wipeleft',    // 左擦除
  'wiperight',   // 右擦除
  'wipeup',      // 上擦除
  'wipedown',    // 下擦除
  // 滑动（slide）
  'slideleft',   // 左滑
  'slideright',  // 右滑
  'slideup',     // 上滑
  'slidedown',   // 下滑
  // 圆形
  'circleopen',  // 圆形展开
  'circleclose', // 圆形收缩
  // 平滑滑动
  'smoothleft',  // 平滑左滑
  'smoothright', // 平滑右滑
  'smoothup',    // 平滑上滑
  'smoothdown',  // 平滑下滑
  // 径向
  'radial',      // 径向模糊
  'distance',    // 距离效果
]);
export type TransitionType = z.infer<typeof TransitionTypeSchema>;

/** 转场配置：duration 是转场持续时长（秒），须 ≤ 两个片段中较短者的时长 */
export const TransitionSchema = z.object({
  type: TransitionTypeSchema,
  duration: z.number().min(0.1).max(3).default(0.5),
});
export type Transition = z.infer<typeof TransitionSchema>;

// ───────────────────────── 片段 Clip ─────────────────────────

/**
 * 时间轴上的一次素材放置。时间单位统一为「帧」，配合 project.fps。
 * - start: 在时间轴上的起始帧
 * - durationInFrames: 在时间轴上占用的帧数
 * - trimStart: 从素材源的第几帧开始取（video/audio 有意义；image 忽略）
 * - transitionOut: 从本片段过渡到同轨下一片段的转场效果（null=硬切）
 */
export const ClipSchema = z.object({
  id: z.string().uuid(),
  assetId: z.string().uuid(),
  start: z.number().int().nonnegative(),
  durationInFrames: z.number().int().positive(),
  trimStart: z.number().int().nonnegative().default(0),
  transform: ClipTransformSchema.default({}),
  transitionOut: TransitionSchema.nullable().default(null),
});
export type Clip = z.infer<typeof ClipSchema>;

// ───────────────────────── 文本片段 TextClip ─────────────────────────

/** 文本样式（预览与导出保持一致） */
export const TextStyleSchema = z.object({
  fontFamily: z.string().default('Arial'),
  fontSize: z.number().int().positive().default(48),
  color: z.string().default('#FFFFFF'), // hex color
  /** 文本对齐：left|center|right */
  align: z.enum(['left', 'center', 'right']).default('center'),
  /** 是否加粗 */
  bold: z.boolean().default(false),
  /** 是否斜体 */
  italic: z.boolean().default(false),
  /** 描边颜色（null=无描边） */
  strokeColor: z.string().nullable().default(null),
  /** 描边宽度（px） */
  strokeWidth: z.number().int().nonnegative().default(2),
  /** 背景颜色（null=透明） */
  backgroundColor: z.string().nullable().default(null),
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

/** 文本片段：独立于 Clip，直接挂在 Timeline 根 */
export const TextClipSchema = z.object({
  id: z.string().uuid(),
  /** 文本内容（支持多行，\n分隔） */
  text: z.string().min(1).max(2000),
  start: z.number().int().nonnegative(),
  durationInFrames: z.number().int().positive(),
  /** 位置：相对画面中心偏移（像素，基于项目分辨率） */
  x: z.number().default(0),
  y: z.number().default(0),
  /** 缩放比例（相对默认尺寸） */
  scale: z.number().positive().default(1),
  /** 旋转角度（度） */
  rotation: z.number().default(0),
  /** 不透明度 0..1 */
  opacity: z.number().min(0).max(1).default(1),
  style: TextStyleSchema.default({}),
});
export type TextClip = z.infer<typeof TextClipSchema>;

// ───────────────────────── 轨道 Track ─────────────────────────

export const TrackKindSchema = z.enum(['video', 'audio', 'text']);
export type TrackKind = z.infer<typeof TrackKindSchema>;

/** 轨道：clips 按 start 排布；tracks 数组顺序即图层顺序（越后越上层） */
export const TrackSchema = z.object({
  id: z.string().uuid(),
  kind: TrackKindSchema,
  muted: z.boolean().default(false),
  /** 隐藏轨道：预览跳过该视频轨（顶层优先时可隐藏顶层看下层），不影响导出 */
  hidden: z.boolean().default(false),
  clips: z.array(ClipSchema).default([]),
  /** 文本轨道（kind='text' 时用此字段，video/audio 轨道忽略） */
  textClips: z.array(TextClipSchema).optional(),
});
export type Track = z.infer<typeof TrackSchema>;

// ───────────────────────── 项目 Project（剪辑状态根） ─────────────────────────

/**
 * 输出规格：同时驱动前端预览画布与 worker 的 FFmpeg 输出。
 * 两端读同一份，保证「预览 = 成片」。
 */
export const ProjectSettingsSchema = z.object({
  fps: z.number().int().positive().default(30),
  width: z.number().int().positive().default(1920),
  height: z.number().int().positive().default(1080),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

/** 可编辑的剪辑内容（前端编辑、PATCH 提交、worker 消费的核心载荷） */
export const TimelineSchema = z.object({
  settings: ProjectSettingsSchema,
  tracks: z.array(TrackSchema).default([]),
});
export type Timeline = z.infer<typeof TimelineSchema>;

/** 完整项目：元信息 + 剪辑状态 */
export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  timeline: TimelineSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Project = z.infer<typeof ProjectSchema>;

/** 新建项目入参（id/时间戳由后端生成；timeline 可省略走默认空） */
export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(200),
  timeline: TimelineSchema.optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

/** 更新项目入参：名称或整份剪辑状态（自动保存提交 timeline） */
export const UpdateProjectSchema = z
  .object({
    name: z.string().min(1).max(200),
    timeline: TimelineSchema,
  })
  .partial();
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;

// ───────────────────────── 导出/渲染任务 RenderJob ─────────────────────────

/** 导出质量档：影响分辨率缩放与码率（CRF/preset）。 */
export const RenderQualitySchema = z.enum(['high', 'medium', 'low']);
export type RenderQuality = z.infer<typeof RenderQualitySchema>;

/** 创建导出任务的入参。 */
export const CreateRenderSchema = z.object({
  projectId: z.string().uuid(),
  /** 下载文件名（不含扩展名）；省略则用项目名 */
  fileName: z.string().max(120).optional(),
  quality: RenderQualitySchema.default('high'),
});
export type CreateRenderInput = z.infer<typeof CreateRenderSchema>;

/** 渲染任务状态（对应 BullMQ job 生命周期） */
export const RenderStatusSchema = z.enum([
  'queued',
  'rendering',
  'completed',
  'failed',
]);
export type RenderStatus = z.infer<typeof RenderStatusSchema>;

/** 渲染任务：worker 用 project 的 timeline 跑 FFmpeg 合成 */
export const RenderJobSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  status: RenderStatusSchema,
  /** 进度 0..100 */
  progress: z.number().min(0).max(100).default(0),
  /** 成片地址（completed 时填充） */
  outputUrl: z.string().url().nullable(),
  /** 建议下载文件名（含扩展名） */
  fileName: z.string().nullable().default(null),
  /** 失败原因（failed 时填充） */
  error: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type RenderJob = z.infer<typeof RenderJobSchema>;

// ───────────────────────── AI 混编任务 AiMix ─────────────────────────

export const AiMixStyleSchema = z.enum(['hook', 'fast', 'steady']);
export type AiMixStyle = z.infer<typeof AiMixStyleSchema>;

export const CreateAiMixSchema = z.object({
  projectId: z.string().uuid(),
  assetIds: z.array(z.string().uuid()).min(1),
  durationSec: z.number().int().min(10).max(60).default(30),
  style: AiMixStyleSchema.default('fast'),
  sellingPoints: z.array(z.string().min(1).max(120)).max(8).default([]),
  cta: z.string().min(1).max(120).default('立即咨询'),
});
export type CreateAiMixInput = z.infer<typeof CreateAiMixSchema>;

export const AiMixStatusSchema = z.enum(['queued', 'running', 'completed', 'failed']);
export type AiMixStatus = z.infer<typeof AiMixStatusSchema>;

export const AiMixJobSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  status: AiMixStatusSchema,
  progress: z.number().min(0).max(100).default(0),
  draftTimeline: TimelineSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type AiMixJob = z.infer<typeof AiMixJobSchema>;

// ───────────────────────── AI 文本生成 LLM ─────────────────────────

/** 对话消息（用于带历史的多轮对话） */
export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** AI 文本生成请求入参 */
export const GenerateTextSchema = z.object({
  /** 用户提示词（单轮快捷模式，与 messages 二选一） */
  prompt: z.string().min(1).max(2000).optional(),
  /** 完整对话历史（多轮模式，包含所有 user 和 assistant 消息） */
  messages: z.array(ChatMessageSchema).optional(),
  /** 生成文本的最大字数限制（默认 100 字） */
  maxLength: z.number().int().positive().default(100),
  /** 模型温度（0-1，越高越随机），可选 */
  temperature: z.number().min(0).max(1).optional(),
}).refine((data) => data.prompt || data.messages, {
  message: 'prompt 或 messages 必须提供其一',
});
export type GenerateTextInput = z.infer<typeof GenerateTextSchema>;

/** AI 文本生成响应 */
export const GeneratedTextSchema = z.object({
  /** 生成的文本内容 */
  text: z.string(),
  /** 实际使用的模型名称 */
  model: z.string(),
  /** token 消耗统计（可选） */
  usage: z
    .object({
      promptTokens: z.number().int(),
      completionTokens: z.number().int(),
      totalTokens: z.number().int(),
    })
    .optional(),
});
export type GeneratedText = z.infer<typeof GeneratedTextSchema>;

// ───────────────────────── AI 图像/视频生成 ─────────────────────────

/** 生成尺寸格式：宽x高（如 "1280x720"）。前端按比例映射到各模型支持的尺寸。 */
const SizeSchema = z
  .string()
  .regex(/^\d{2,5}x\d{2,5}$/, 'size 格式应为 "宽x高"，如 1280x720');

/** AI 图像生成请求 */
export const GenerateImageSchema = z.object({
  prompt: z.string().min(1).max(2000),
  size: SizeSchema.default('1024x1024'),
});
export type GenerateImageInput = z.infer<typeof GenerateImageSchema>;

/** AI 视频生成请求 */
export const GenerateVideoSchema = z.object({
  prompt: z.string().min(1).max(2000),
  size: SizeSchema.default('1280x720'),
});
export type GenerateVideoInput = z.infer<typeof GenerateVideoSchema>;

/** AI 生成任务状态（复用 Asset 生成状态） */
export const AiGenJobStatusSchema = z.enum(['queued', 'generating', 'completed', 'failed']);
export type AiGenJobStatus = z.infer<typeof AiGenJobStatusSchema>;

/** AI 生成任务记录 */
export const AiGenJobSchema = z.object({
  id: z.string().uuid(),
  /** 生成的 Asset ID（generating 时存在，前端轮询该 Asset 的 status） */
  assetId: z.string().uuid().nullable(),
  type: z.enum(['image', 'video']),
  prompt: z.string(),
  status: AiGenJobStatusSchema,
  error: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type AiGenJob = z.infer<typeof AiGenJobSchema>;
