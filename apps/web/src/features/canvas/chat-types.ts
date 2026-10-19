export type CanvasChatReference = {
  id: string;
  kind: 'text' | 'image' | 'video' | 'audio';
  title: string;
  content?: string;
  prompt?: string;
  assetId?: string;
  url?: string;
  description?: string;
};

export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type Conversation = ConversationSummary & {
  messages: { id: string; role: 'user' | 'assistant'; content: string; references: CanvasChatReference[]; createdAt: string }[];
};
