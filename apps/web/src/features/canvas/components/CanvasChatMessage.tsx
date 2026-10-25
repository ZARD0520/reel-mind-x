import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { useTypewriterText } from '../useTypewriterText';
import { rehypeChatCaret } from '../rehypeChatCaret';
import type { CanvasChatReference } from '../chat-types';
import { CanvasChatReferenceChip } from './CanvasChatReferenceChip';
import { referenceIds, splitReferences } from '../inline-references';

const markdownPlugins = [remarkGfm];
const htmlPlugins = [rehypeRaw, rehypeSanitize];
const typingHtmlPlugins = [...htmlPlugins, rehypeChatCaret];

export function CanvasChatMessage({ role, content, references = [], availableNodeIds, onFocusNode, typing = false, complete = false, onTypingComplete, onTypingProgress }: {
  role: 'user' | 'assistant';
  content: string;
  references?: CanvasChatReference[];
  availableNodeIds: ReadonlySet<string>;
  onFocusNode: (nodeId: string) => void;
  typing?: boolean;
  complete?: boolean;
  onTypingComplete?: () => void;
  onTypingProgress?: () => void;
}) {
  const visible = useTypewriterText(content, typing);
  const notified = useRef(false);

  useEffect(() => {
    if (typing && complete && visible === content && !notified.current) {
      notified.current = true;
      onTypingComplete?.();
    }
  }, [typing, complete, visible, content, onTypingComplete]);

  useEffect(() => {
    if (typing) onTypingProgress?.();
  }, [typing, visible, onTypingProgress]);

  if (role === 'user') {
    // 引用既可能是画布节点，也可能是聊天附件素材（资产引用带 assetId/url，非画布节点）
    const isAvailable = (reference?: CanvasChatReference) =>
      !!reference && (availableNodeIds.has(reference.id) || !!reference.assetId || !!reference.url);
    return <div className="max-w-[90%] self-end whitespace-pre-wrap break-words rounded-2xl bg-[#303030] px-4 py-2 text-sm leading-6 text-[#f3f3f0]">
      {splitReferences(content).map((part, index) => {
        const reference = references.find((item) => item.id === part.id);
        return part.id ? <CanvasChatReferenceChip key={index} reference={reference ?? { id: part.id, title: part.title ?? '', kind: 'text' }} available={isAvailable(reference)} onFocusNode={onFocusNode} /> : part.text;
      })}
      {references.filter((item) => !referenceIds(content).includes(item.id)).map((reference) => <CanvasChatReferenceChip key={reference.id} reference={reference} available={isAvailable(reference)} onFocusNode={onFocusNode} />)}
    </div>;
  }

  return (
    <div className="min-w-0 max-w-full self-start break-words text-sm leading-6 text-[#dededb]">
      <div className="space-y-3 [&_a]:text-[#a9c9ff] [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-white/25 [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1 [&_code]:py-0.5 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_hr]:border-white/20 [&_img]:max-w-full [&_img]:rounded-lg [&_li]:ml-5 [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-[#242424] [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_td]:border [&_td]:border-white/20 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-white/20 [&_th]:px-2 [&_th]:py-1 [&_ul]:list-disc">
        <ReactMarkdown
          remarkPlugins={markdownPlugins}
          rehypePlugins={typing ? typingHtmlPlugins : htmlPlugins}
          components={{
            a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
          }}
        >{visible}</ReactMarkdown>
      </div>
    </div>
  );
}
