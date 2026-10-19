// Clone the actual Lucide SVGs rendered by React, keeping the editable chips
// identical to the rest of the canvas without maintaining separate SVG paths.
export function createReferenceIcon(kind: 'text' | 'image' | 'video' | 'remove', templates: HTMLElement, variant: 'node' | 'chat') {
  const templateKind = kind === 'text' && variant === 'node' ? 'node-text' : kind;
  const template = templates.querySelector<SVGElement>(`[data-reference-kind="${templateKind}"]`)!;
  const svg = template.cloneNode(true) as SVGElement;
  svg.setAttribute('data-reference-kind', kind);
  return svg;
}