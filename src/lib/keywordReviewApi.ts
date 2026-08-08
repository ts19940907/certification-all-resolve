import { supabase } from './supabase';
import { getErrorMessage } from './certificationsApi';
import type { KeywordReviewResult } from '../types/keywordReview';

type ReviewEdgeSuccess = {
  ok: true;
  review: KeywordReviewResult;
};

type ReviewEdgeFailure = {
  ok: false;
  error?: string;
};

export async function reviewKeyword(args: {
  certificationId: string;
  keyword: string;
  explanation: string;
}): Promise<KeywordReviewResult> {
  const { data, error } = await supabase.functions.invoke('review-keyword', {
    body: {
      certification_id: args.certificationId,
      keyword: args.keyword,
      explanation: args.explanation,
    },
  });

  const payload = (data ?? null) as ReviewEdgeSuccess | ReviewEdgeFailure | null;

  if (payload && 'ok' in payload && payload.ok === true) {
    return payload.review;
  }

  if (payload && 'ok' in payload && payload.ok === false) {
    throw new Error(payload.error || 'キーワードレビューに失敗しました');
  }

  if (error) {
    console.error('[keyword] review-keyword invoke', error);
    throw error;
  }

  throw new Error('キーワードレビューに失敗しました');
}

export function getKeywordReviewErrorMessage(error: unknown) {
  return getErrorMessage(error, 'キーワードレビューに失敗しました');
}
