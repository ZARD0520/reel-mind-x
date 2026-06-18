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
});
export type ClipTransform = z.infer<typeof ClipTransformSchema>;

// ───────────────────────── 片段 Clip ─────────────────────────

/**
 * 时间轴上的一次素材放置。时间单位统一为「帧」，配合 project.fps。
 * - start: 在时间轴上的起始帧
 * - durationInFrames: 在时间轴上占用的帧数
 * - trimStart: 从素材源的第几帧开始取（video/audio 有意义；image 忽略）
 */
export const ClipSchema = z.object({
  id: z.string().uuid(),
  assetId: z.string().uuid(),
  start: z.number().int().nonnegative(),
  durationInFrames: z.number().int().positive(),
  trimStart: z.number().int().nonnegative().default(0),
  transform: ClipTransformSchema.default({}),
});
export type Clip = z.infer<typeof ClipSchema>;

// ───────────────────────── 轨道 Track ─────────────────────────

export const TrackKindSchema = z.enum(['video', 'audio']);
export type TrackKind = z.infer<typeof TrackKindSchema>;

/** 轨道：clips 按 start 排布；tracks 数组顺序即图层顺序（越后越上层） */
export const TrackSchema = z.object({
  id: z.string().uuid(),
  kind: TrackKindSchema,
  muted: z.boolean().default(false),
  /** 隐藏轨道：预览跳过该视频轨（顶层优先时可隐藏顶层看下层），不影响导出 */
  hidden: z.boolean().default(false),
  clips: z.array(ClipSchema).default([]),
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
  /** 失败原因（failed 时填充） */
  error: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type RenderJob = z.infer<typeof RenderJobSchema>;

