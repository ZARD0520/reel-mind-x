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
  agentRuns?: { id: string; status: string; events: AgentToolProgress[]; error?: string | null }[];
  messages: { id: string; role: 'user' | 'assistant'; content: string; references: CanvasChatReference[]; createdAt: string }[];
};
export type AgentPlanProgress = { runId: string; goal: string; mode: 'execute' | 'answer' | 'clarify'; steps: { id: string; description: string; tool: string }[] };
import type { CanvasGraph } from '@reel/contracts';

export type AgentToolProgress = { id: string; name: string; title: string; status: 'running' | 'completed' | 'failed'; result?: Record<string, unknown>; runId: string };
export type CanvasAgentBridge = {
  prepare: () => Promise<{ selectedNodeIds: string[] }>;
  apply: (graph: CanvasGraph) => void;
  release: () => Promise<void>;
};
