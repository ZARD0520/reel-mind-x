import type { TextClip } from '@reel/contracts';

/**
 * 预览字体栈：对齐导出端 FFmpeg `resolveFontFile` 实际使用的系统字体
 * （Windows=微软雅黑 msyh.ttc / macOS=苹方 / Linux=Noto Sans CJK）。
 * 导出忽略 style.fontFamily、按 bold 选字体文件，故预览也统一用此栈，
 * 避免预览走浏览器对 'Arial' 的中文回退（宋体）而导出是雅黑，两端字体不一致。
 */
const PREVIEW_FONT_STACK =
  '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Noto Sans SC", sans-serif';

interface TextLayerProps {
  textClip: TextClip;
  /** 项目坐标 → 舞台显示坐标的缩放比例 */
  displayScale: number;
  /** 舞台内容区（letterbox 后的实际画面区域） */
  baseLeft: number;
  baseTop: number;
  baseWidth: number;
  baseHeight: number;
}

/**
 * 文本图层：渲染单个文本片段到画布（绝对定位，叠加在视频之上）。
 * 用 DOM 文本渲染（canvas text 中文字体复杂），x=0/y=0 表示画面中心。
 */
export function TextLayer({ textClip, displayScale, baseLeft, baseTop, baseWidth, baseHeight }: TextLayerProps) {
  const { text, x, y, scale, rotation, opacity, style } = textClip;
  const { fontSize, color, align, bold, italic, strokeColor, strokeWidth, backgroundColor } = style;

  const textStyle: React.CSSProperties = {
    fontFamily: PREVIEW_FONT_STACK,
    fontSize: fontSize * displayScale,
    color,
    fontWeight: bold ? 'bold' : 'normal',
    fontStyle: italic ? 'italic' : 'normal',
    textAlign: align,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    lineHeight: 1.2,
    ...(strokeColor && strokeWidth > 0 && {
      // 描边宽度随显示缩放同步（与 fontSize 一致），否则预览缩小后描边相对字号过粗把字芯吃掉。
      WebkitTextStroke: `${strokeWidth * displayScale}px ${strokeColor}`,
      // paint-order=stroke：先描边后填充，填充盖在描边上 → 描边只露在字形外侧，
      // 与导出端 FFmpeg drawtext 的外侧 borderw 语义一致（预览=成片），字芯保持清晰。
      paintOrder: 'stroke',
    }),
    ...(backgroundColor && {
      backgroundColor,
      padding: '4px 12px',
      borderRadius: '4px',
    }),
  };

  // 容器填满画面区，flex 居中；再按 x/y 偏移 + 缩放 + 旋转。
  return (
    <div
      className="pointer-events-none absolute flex items-center justify-center"
      style={{
        left: baseLeft,
        top: baseTop,
        width: baseWidth,
        height: baseHeight,
        opacity,
      }}
    >
      <div
        style={{
          transform: `translate(${x * displayScale}px, ${y * displayScale}px) scale(${scale}) rotate(${rotation}deg)`,
          transformOrigin: 'center center',
          maxWidth: '90%',
        }}
      >
        <div style={textStyle}>{text}</div>
      </div>
    </div>
  );
}
