// 预览/时间轴共用的基础常量（渲染器无关）。
// 真实时长后续由剪辑状态（片段总长）推导，这里先用固定值。
export const PREVIEW_FPS = 30;
export const PREVIEW_DURATION_SECONDS = 30;
export const PREVIEW_WIDTH = 1920;
export const PREVIEW_HEIGHT = 1080;
export const DURATION_IN_FRAMES = PREVIEW_DURATION_SECONDS * PREVIEW_FPS;

/** 常见画布比例（宽:高），画布比例选择器与 AI 生成尺寸共用。 */
export const ASPECT_RATIOS = [
  { label: '16:9 横屏', w: 16, h: 9 },
  { label: '9:16 竖屏', w: 9, h: 16 },
  { label: '1:1 方形', w: 1, h: 1 },
  { label: '4:3 标清', w: 4, h: 3 },
  { label: '21:9 超宽', w: 21, h: 9 },
] as const;

export type AspectRatioKey = '16:9' | '9:16' | '1:1' | '4:3' | '21:9';

/**
 * AI 图像生成尺寸（智谱 CogView-3-Flash）：比例 → API size 参数。
 * 21:9 智谱无对应尺寸，回退到 16:9。
 */
export const IMAGE_SIZE_BY_RATIO: Record<AspectRatioKey, string> = {
  '16:9': '1344x768',
  '9:16': '768x1344',
  '1:1': '1024x1024',
  '4:3': '1024x768',
  '21:9': '1344x768',
};

/**
 * AI 视频生成尺寸（智谱 CogVideoX-Flash）：比例 → API size 参数。
 * 智谱视频尺寸有限，4:3/21:9 回退到 16:9。
 */
export const VIDEO_SIZE_BY_RATIO: Record<AspectRatioKey, string> = {
  '16:9': '1280x720',
  '9:16': '720x1280',
  '1:1': '960x960',
  '4:3': '1280x720',
  '21:9': '1280x720',
};

/** 比例选项（供 AI 生成尺寸选择器用，label 与画布比例一致） */
export const RATIO_OPTIONS: { key: AspectRatioKey; label: string }[] = [
  { key: '16:9', label: '16:9 横屏' },
  { key: '9:16', label: '9:16 竖屏' },
  { key: '1:1', label: '1:1 方形' },
  { key: '4:3', label: '4:3 标清' },
];

