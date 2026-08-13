import { supabase } from './supabase';
import type { SrsRating } from '../types/srs';

export type ExampleAnswerStats = {
  correct: number;
  wrong: number;
};

export type ExampleSrsSignal = {
  easeFactor: number;
  lastRating: SrsRating | null;
};

/** まとめて解く／試験履歴から例題ごとの正誤回数を集計 */
export async function fetchExampleAnswerStats(
  certificationId: string,
): Promise<Map<string, ExampleAnswerStats>> {
  const { data, error } = await supabase
    .from('histories')
    .select('detail')
    .eq('certification_id', certificationId)
    .in('kind', ['example_batch', 'exam']);

  if (error) {
    console.error('[batchPick] answer stats', error);
    throw error;
  }

  const map = new Map<string, ExampleAnswerStats>();
  for (const row of data ?? []) {
    const detail = row.detail as {
      results?: Array<{ example_id?: string; correct?: boolean }>;
    } | null;
    if (!detail || !Array.isArray(detail.results)) continue;
    for (const item of detail.results) {
      const id = String(item.example_id ?? '').trim();
      if (!id) continue;
      const prev = map.get(id) ?? { correct: 0, wrong: 0 };
      if (item.correct) prev.correct += 1;
      else prev.wrong += 1;
      map.set(id, prev);
    }
  }
  return map;
}

/** 例題 SRS カードの弱さ信号（キーワードカードは除外） */
export async function fetchExampleSrsSignals(
  certificationId: string,
): Promise<Map<string, ExampleSrsSignal>> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error('ログインが必要です。');
  }

  const { data, error } = await supabase
    .from('srs_cards')
    .select('example_id, ease_factor, last_rating')
    .eq('user_id', user.id)
    .eq('certification_id', certificationId)
    .eq('kind', 'example');

  if (error) {
    console.error('[batchPick] srs signals', error);
    throw error;
  }

  const map = new Map<string, ExampleSrsSignal>();
  for (const row of data ?? []) {
    const id = String(row.example_id ?? '').trim();
    if (!id) continue;
    const rating = row.last_rating;
    map.set(id, {
      easeFactor: Number(row.ease_factor) || 2.5,
      lastRating:
        rating === 'again' ||
        rating === 'hard' ||
        rating === 'good' ||
        rating === 'easy'
          ? rating
          : null,
    });
  }
  return map;
}

/**
 * 苦手 > 未解答 > 得意 の重み。
 * 保証枠なしの相対重み（最小 0.15）。
 */
export function computeBatchPickWeight(
  stats: ExampleAnswerStats | undefined,
  srs: ExampleSrsSignal | undefined,
): number {
  const correct = stats?.correct ?? 0;
  const wrong = stats?.wrong ?? 0;
  const answered = correct + wrong > 0;

  let weight: number;
  if (!answered) {
    weight = 4;
  } else {
    weight = 1 + wrong * 2.5;
    if (wrong === 0 && correct > 0) {
      // 正解のみ → 得意寄りに軽く
      weight = Math.max(0.35, 1 - Math.min(correct, 6) * 0.12);
    } else if (correct > wrong) {
      weight = Math.max(0.5, weight - (correct - wrong) * 0.35);
    }
  }

  if (srs) {
    if (srs.lastRating === 'again') weight += 4;
    else if (srs.lastRating === 'hard') weight += 2.5;
    else if (srs.lastRating === 'easy') weight *= 0.7;

    if (srs.easeFactor < 2.0) weight += 2;
    else if (srs.easeFactor < 2.3) weight += 1;
    else if (srs.easeFactor >= 2.8) weight *= 0.85;
  }

  return Math.max(0.15, weight);
}

/** 重み付き抽選（非復元）。weights は ids と同順 */
export function pickWeightedExampleIds(
  ids: string[],
  weights: number[],
  count: number,
): string[] {
  if (ids.length === 0 || count <= 0) return [];
  const poolIds = [...ids];
  const poolWeights = weights.map((w) => Math.max(0.15, w));
  const take = Math.min(count, poolIds.length);
  const picked: string[] = [];

  for (let n = 0; n < take; n += 1) {
    let total = 0;
    for (const w of poolWeights) total += w;
    let r = Math.random() * total;
    let index = poolWeights.length - 1;
    for (let i = 0; i < poolWeights.length; i += 1) {
      r -= poolWeights[i]!;
      if (r <= 0) {
        index = i;
        break;
      }
    }
    picked.push(poolIds[index]!);
    poolIds.splice(index, 1);
    poolWeights.splice(index, 1);
  }

  return picked;
}

export async function pickBatchExampleIds(args: {
  certificationId: string;
  exampleIds: string[];
  count: number;
}): Promise<string[]> {
  const ids = args.exampleIds;
  if (ids.length === 0 || args.count <= 0) return [];

  const [answerStats, srsSignals] = await Promise.all([
    fetchExampleAnswerStats(args.certificationId),
    fetchExampleSrsSignals(args.certificationId),
  ]);

  const weights = ids.map((id) =>
    computeBatchPickWeight(answerStats.get(id), srsSignals.get(id)),
  );

  return pickWeightedExampleIds(ids, weights, args.count);
}
