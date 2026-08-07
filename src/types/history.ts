export type HistoryKind = 'example_ai_chat';

export type HistoryChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

export type ExampleAiChatDetail = {
  example_id: string;
  messages: HistoryChatMessage[];
};

export type HistorySummary = {
  id: string;
  kind: HistoryKind | string;
  title: string;
  summary: string;
  performedAt: string;
  performedAtRaw: string;
  detail: ExampleAiChatDetail | null;
};
