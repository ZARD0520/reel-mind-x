import { useState } from 'react';
import { Loader2, Sparkles, Trash2, X } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import type { GeneratedText } from '@reel/contracts';
import { api } from '../../../lib/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface TextGenDialogProps {
  open: boolean;
  onClose: () => void;
  /** 应用生成结果：选中文本片段则更新，否则新建（由调用方决定） */
  onApply: (text: string) => void;
}

export function TextGenDialog({ open, onClose, onApply }: TextGenDialogProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');

  const generate = useMutation({
    // 传完整对话历史，让模型记住上下文（多轮对话）。
    mutationFn: (nextMessages: Message[]) =>
      api.textGen.generate({ messages: nextMessages, maxLength: 100 }) as Promise<GeneratedText>,
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: 'assistant', content: data.text }]);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || generate.isPending) return;
    // 把新的 user 消息拼进历史，一并发给后端。
    const nextMessages: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setInput('');
    generate.mutate(nextMessages);
  };

  const handleApply = (text: string) => {
    onApply(text);
    onClose();
  };

  /** 清空对话历史（保留弹窗打开状态） */
  const handleClear = () => {
    setMessages([]);
    setInput('');
    generate.reset();
  };

  const handleClose = () => {
    setMessages([]);
    setInput('');
    generate.reset();
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4">
      <div className="flex h-[600px] w-[520px] max-w-full flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-2xl">
        {/* 头部 */}
        <div className="flex h-13 items-center justify-between border-b border-border-subtle px-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            <span className="text-sm font-semibold">AI 文案生成</span>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={handleClear}
                title="清空对话"
                className="flex items-center gap-1 rounded px-2 py-1 text-[12px] text-fg-tertiary hover:bg-elevated hover:text-fg"
              >
                <Trash2 className="h-3.5 w-3.5" />
                清空
              </button>
            )}
            <button type="button" onClick={handleClose} className="text-fg-tertiary hover:text-fg">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 聊天消息区 */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-fg-tertiary">
              <Sparkles className="h-8 w-8 opacity-40" />
              <p className="text-[13px]">描述你想要的文案风格或内容</p>
              <p className="text-[12px] opacity-70">比如：给一款续航手机写卖点文案</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-[13px] ${
                      msg.role === 'user'
                        ? 'bg-accent text-white'
                        : 'border border-border-subtle bg-elevated text-fg'
                    }`}
                  >
                    {msg.content}
                    {msg.role === 'assistant' && (
                      <button
                        type="button"
                        onClick={() => handleApply(msg.content)}
                        className="mt-2 w-full rounded border border-border-subtle bg-surface py-1 text-[12px] text-accent hover:bg-accent-soft"
                      >
                        用这条
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {generate.isPending && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-elevated px-3 py-2 text-[13px] text-fg-tertiary">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    生成中...
                  </div>
                </div>
              )}
              {generate.isError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
                  {generate.error instanceof Error ? generate.error.message : '生成失败'}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 输入框 */}
        <form onSubmit={handleSubmit} className="border-t border-border-subtle p-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="告诉 AI 你想要什么样的文案..."
              disabled={generate.isPending}
              className="flex-1 rounded-lg border border-border-subtle bg-input px-3 py-2 text-[13px] text-fg outline-none placeholder:text-fg-tertiary focus:border-accent disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || generate.isPending}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              生成
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

