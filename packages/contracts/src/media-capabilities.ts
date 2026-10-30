/** 智谱官方模型规格；UI 和请求校验共用。 */
export const IMAGE_SIZES = ['1024x1024', '768x1344', '864x1152', '1344x768', '1152x864', '1440x720', '720x1440'] as const;
export const VIDEO_SIZES = ['720x480', '1024x1024', '1280x960', '960x1280', '1920x1080', '1080x1920', '2048x1080', '3840x2160'] as const;
export const VIDEO_PROMPT_LIMIT = 512;
export const IMAGE_PROMPT_LIMIT = 2000;
export const VIDEO_REFERENCE_MAX_BYTES = 5 * 1024 * 1024;
export function validImageSize(size: string): boolean {
  if (!/^\d+x\d+$/.test(size)) return false;
  const [w = 0, h = 0] = size.split('x').map(Number);
  return w >= 512 && h >= 512 && w <= 2048 && h <= 2048 && w % 16 === 0 && h % 16 === 0 && w * h <= 2 ** 21;
}

export const KOLORS_MODEL = 'Kwai-Kolors/Kolors';
export const KOLORS_IMAGE_SIZES = ['1024x1024', '960x1280', '768x1024', '720x1440', '720x1280'] as const;
export function imageSizesForModel(model?: string): readonly string[] {
  return model === KOLORS_MODEL ? KOLORS_IMAGE_SIZES : IMAGE_SIZES;
}
export function validImageSizeForModel(size: string, model?: string): boolean {
  return model === KOLORS_MODEL ? imageSizesForModel(model).includes(size) : validImageSize(size);
}
