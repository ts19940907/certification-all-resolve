import type { KeywordReviewResult } from './keywordReview';

export type HistoryKind = 'example_ai_chat' | 'keyword_review';

export type HistoryChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

export type ExampleAiChatDetail = {
  example_id: string;
  messages: HistoryChatMessage[];
};

export type KeywordReviewDetail = KeywordReviewResult;

export type HistoryDetail = ExampleAiChatDetail | KeywordReviewDetail;

export type HistorySummary = {
  id: string;
  kind: HistoryKind | string;
  title: string;
  summary: string;
  performedAt: string;
  performedAtRaw: string;
  detail: HistoryDetail | null;
};

export function isExampleAiChatDetail(
  detail: HistoryDetail | null,
  kind: string,
): detail is ExampleAiChatDetail {
  return (
    kind === 'example_ai_chat' &&
    detail != null &&
    'example_id' in detail &&
    'messages' in detail
  );
}

export function isKeywordReviewDetail(
  detail: HistoryDetail | null,
  kind: string,
): detail is KeywordReviewDetail {
  return (
    kind === 'keyword_review' &&
    detail != null &&
    'keyword' in detail &&
    'grade' in detail
  );
}
