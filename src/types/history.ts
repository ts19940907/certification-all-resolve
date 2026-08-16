import type { KeywordReviewResult } from './keywordReview';

export type HistoryKind =
  | 'example_ai_chat'
  | 'keyword_review'
  | 'example_batch'
  | 'exam';

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

export type ExampleBatchResultItem = {
  example_id: string;
  title: string;
  correct: boolean;
};

export type ExampleBatchDetail = {
  total: number;
  correct_count: number;
  results: ExampleBatchResultItem[];
};

export type HistoryDetail =
  | ExampleAiChatDetail
  | KeywordReviewDetail
  | ExampleBatchDetail;

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

export function isExampleBatchDetail(
  detail: HistoryDetail | null,
  kind: string,
): detail is ExampleBatchDetail {
  return (
    (kind === 'example_batch' || kind === 'exam') &&
    detail != null &&
    'total' in detail &&
    'correct_count' in detail &&
    'results' in detail
  );
}
