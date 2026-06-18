// 预览/时间轴共用的基础常量（渲染器无关）。
// 真实时长后续由剪辑状态（片段总长）推导，这里先用固定值。
export const PREVIEW_FPS = 30;
export const PREVIEW_DURATION_SECONDS = 30;
export const PREVIEW_WIDTH = 1920;
export const PREVIEW_HEIGHT = 1080;
export const DURATION_IN_FRAMES = PREVIEW_DURATION_SECONDS * PREVIEW_FPS;
