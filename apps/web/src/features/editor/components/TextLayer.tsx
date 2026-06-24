import type { TextClip } from '@reel/contracts';

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
  const { fontFamily, fontSize, color, align, bold, italic, strokeColor, strokeWidth, backgroundColor } = style;

  const textStyle: React.CSSProperties = {
    fontFamily,
    fontSize: fontSize * displayScale,
    color,
    fontWeight: bold ? 'bold' : 'normal',
    fontStyle: italic ? 'italic' : 'normal',
    textAlign: align,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    lineHeight: 1.2,
    ...(strokeColor && {
      WebkitTextStroke: `${strokeWidth}px ${strokeColor}`,
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
