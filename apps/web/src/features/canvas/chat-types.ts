export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type Conversation = ConversationSummary & {
  messages: { id: string; role: 'user' | 'assistant'; content: string; createdAt: string }[];
};
