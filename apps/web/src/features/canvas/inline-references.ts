// Store identity and position in the prompt itself; titles may change or be duplicated.
export function referenceToken(reference: { id: string; title: string }) {
  return `@[${encodeURIComponent(reference.title)}](node:${encodeURIComponent(reference.id)})`;
}

export function splitReferences(value: string) {
  const parts: { text: string; id?: string; title?: string }[] = [];
  const pattern = /@\[([^\]]*)\]\(node:([^)]*)\)/g;
  let start = 0;
  for (const match of value.matchAll(pattern)) {
    try {
      const title = decodeURIComponent(match[1]!);
      const id = decodeURIComponent(match[2]!);
      if (match.index! > start) parts.push({ text: value.slice(start, match.index) });
      parts.push({ text: match[0], id, title });
      start = match.index! + match[0].length;
    } catch { /* Malformed pasted tokens remain ordinary text. */ }
  }
  if (start < value.length) parts.push({ text: value.slice(start) });
  return parts;
}

export function referenceIds(value: string) {
  return [...new Set(splitReferences(value).flatMap((part) => part.id ? [part.id] : []))];
}

export function readableReferences(value: string) {
  return splitReferences(value).map((part) => part.id ? `【${part.title}】` : part.text).join('');
}
