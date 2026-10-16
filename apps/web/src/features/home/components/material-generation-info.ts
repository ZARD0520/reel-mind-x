import type { Asset, AssetReference } from '@reel/contracts';

export function materialGenerationInfo(asset: Asset): { prompt: string; references: AssetReference[] } {
  const prompt = asset.prompt ?? '';
  if (asset.references?.length) return { prompt, references: asset.references };
  // 兼容旧画布生成时拼接的文本上下文；不猜测未保存的媒体引用。
  let match = prompt.match(/^参考文本：\n([\s\S]*)\n\n画面要求：([\s\S]*)$/);
  let referenceText: string | undefined;
  let userPrompt = prompt;
  if (match) { referenceText = match[1]; userPrompt = match[2] ?? ''; }
  else if ((match = prompt.match(/^视频要求：([\s\S]*?)\n\n参考文本：\n([\s\S]*)$/))) {
    userPrompt = match[1] ?? ''; referenceText = match[2];
  } else if ((match = prompt.match(/^请参考以下内容：\n([\s\S]*)\n\n生成要求：([\s\S]*)$/))) {
    referenceText = match[1]; userPrompt = match[2] ?? '';
  }
  const references: AssetReference[] = referenceText
    ? referenceText.split(/\n(?=【[^\n]+】)/).map((content, index) => {
      const named = content.match(/^【([^\n]+)】([\s\S]*)$/);
      return { kind: 'text', name: named?.[1] || `参考文本 ${index + 1}`, content: named?.[2] ?? content };
    }) : [];
  return { prompt: userPrompt, references };
}
