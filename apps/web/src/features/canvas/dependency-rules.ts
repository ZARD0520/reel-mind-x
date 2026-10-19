type Kind = 'text' | 'image' | 'video' | 'audio';

export function acceptsDependency(source: Kind, target: Kind): boolean {
  if (target === 'image' || target === 'audio') return source === 'text';
  if (target === 'video') return source === 'text' || source === 'image' || source === 'audio';
  return source !== 'audio';
}

export function acceptsDependencyInput(node: { kind: Kind; uploaded?: boolean }): boolean {
  return !node.uploaded;
}
