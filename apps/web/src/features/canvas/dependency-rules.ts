type Kind = 'text' | 'image' | 'video' | 'audio' | 'edit';

export function acceptsDependency(source: Kind, target: Kind, model?: string): boolean {
  if (source === 'edit') return false;
  if (target === 'edit') return source === 'image' || source === 'video' || source === 'audio';
  if (target === 'image') return source === 'text' || (model === 'Kwai-Kolors/Kolors' && source === 'image');
  if (target === 'audio') return source === 'text';
  if (target === 'video') return source === 'text' || source === 'image' || source === 'audio';
  return source !== 'audio';
}

export function acceptsDependencyInput(node: { kind: Kind; uploaded?: boolean }): boolean {
  return !node.uploaded;
}
