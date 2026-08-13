import { supabase } from './supabase';
import { getErrorMessage } from './certificationsApi';
import { initialSrsState, localDateString, applySm2 } from './sm2';
import type { SrsCard, SrsRating } from '../types/srs';
import { SRS_SESSION_LIMIT } from '../types/srs';

type SrsCardRow = {
  id: string;
  user_id: string;
  certification_id: string;
  kind: string;
  keyword_text: string | null;
  keyword_back: string;
  example_id: string | null;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  due_on: string;
  last_rating: string | null;
};

function mapCard(row: SrsCardRow): SrsCard {
  return {
    id: row.id,
    userId: row.user_id,
    certificationId: row.certification_id,
    kind: row.kind as SrsCard['kind'],
    keywordText: row.keyword_text,
    keywordBack: row.keyword_back ?? '',
    exampleId: row.example_id,
    easeFactor: Number(row.ease_factor) || 2.5,
    intervalDays: Number(row.interval_days) || 0,
    repetitions: Number(row.repetitions) || 0,
    dueOn: row.due_on,
    lastRating: (row.last_rating as SrsRating | null) ?? null,
  };
}

async function requireUserId(): Promise<string> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    throw new Error('ログインが必要です。');
  }
  return user.id;
}

export async function fetchDueSrsCount(
  certificationId: string,
  today = localDateString(),
): Promise<number> {
  const userId = await requireUserId();
  const { count, error } = await supabase
    .from('srs_cards')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('certification_id', certificationId)
    .lte('due_on', today);

  if (error) {
    console.error('[srs] due count', error);
    throw error;
  }
  return count ?? 0;
}

export async function fetchDueSrsCards(
  certificationId: string,
  today = localDateString(),
  limit = SRS_SESSION_LIMIT,
): Promise<SrsCard[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('srs_cards')
    .select(
      `
      id,
      user_id,
      certification_id,
      kind,
      keyword_text,
      keyword_back,
      example_id,
      ease_factor,
      interval_days,
      repetitions,
      due_on,
      last_rating
    `,
    )
    .eq('user_id', userId)
    .eq('certification_id', certificationId)
    .lte('due_on', today)
    .order('due_on', { ascending: true })
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[srs] due cards', error);
    throw error;
  }

  return ((data ?? []) as SrsCardRow[]).map(mapCard);
}

/** キーワード A/B 後。既存があれば裏面（自己説明）を更新し、新規なら当日 due で作成 */
export async function upsertKeywordSrsCard(args: {
  certificationId: string;
  keyword: string;
  explanation: string;
}): Promise<void> {
  const userId = await requireUserId();
  const keyword = args.keyword.trim();
  const explanation = args.explanation.trim();
  if (!keyword || !explanation) return;

  // unique index は lower(trim(keyword_text)) なので大小無視で既存を探す
  const { data: existing } = await supabase
    .from('srs_cards')
    .select('id')
    .eq('user_id', userId)
    .eq('certification_id', args.certificationId)
    .eq('kind', 'keyword')
    .ilike('keyword_text', keyword)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase
      .from('srs_cards')
      .update({ keyword_back: explanation, keyword_text: keyword })
      .eq('id', existing.id);
    if (error) {
      console.error('[srs] update keyword card', error);
      throw error;
    }
    return;
  }

  const initial = initialSrsState();
  const { error } = await supabase.from('srs_cards').insert({
    user_id: userId,
    certification_id: args.certificationId,
    kind: 'keyword',
    keyword_text: keyword,
    keyword_back: explanation,
    example_id: null,
    ease_factor: initial.easeFactor,
    interval_days: initial.intervalDays,
    repetitions: initial.repetitions,
    due_on: initial.dueOn,
  });

  if (error) {
    console.error('[srs] insert keyword card', error);
    throw error;
  }
}

/** 例題正解後。未登録なら当日 due で作成。既存は触らない（スケジュール維持） */
export async function ensureExampleSrsCard(args: {
  certificationId: string;
  exampleId: string;
}): Promise<void> {
  const userId = await requireUserId();
  const { data: existing } = await supabase
    .from('srs_cards')
    .select('id')
    .eq('user_id', userId)
    .eq('example_id', args.exampleId)
    .maybeSingle();

  if (existing?.id) return;

  const initial = initialSrsState();
  const { error } = await supabase.from('srs_cards').insert({
    user_id: userId,
    certification_id: args.certificationId,
    kind: 'example',
    keyword_text: null,
    keyword_back: '',
    example_id: args.exampleId,
    ease_factor: initial.easeFactor,
    interval_days: initial.intervalDays,
    repetitions: initial.repetitions,
    due_on: initial.dueOn,
  });

  if (error) {
    // unique race
    if ((error as { code?: string }).code === '23505') return;
    console.error('[srs] insert example card', error);
    throw error;
  }
}

export async function rateSrsCard(args: {
  card: SrsCard;
  rating: SrsRating;
  today?: string;
}): Promise<SrsCard> {
  const today = args.today ?? localDateString();
  const next = applySm2(
    {
      easeFactor: args.card.easeFactor,
      intervalDays: args.card.intervalDays,
      repetitions: args.card.repetitions,
    },
    args.rating,
    today,
  );

  const { data, error } = await supabase
    .from('srs_cards')
    .update({
      ease_factor: next.easeFactor,
      interval_days: next.intervalDays,
      repetitions: next.repetitions,
      due_on: next.dueOn,
      last_rating: args.rating,
    })
    .eq('id', args.card.id)
    .select(
      `
      id,
      user_id,
      certification_id,
      kind,
      keyword_text,
      keyword_back,
      example_id,
      ease_factor,
      interval_days,
      repetitions,
      due_on,
      last_rating
    `,
    )
    .single();

  if (error) {
    console.error('[srs] rate', error);
    throw error;
  }

  return mapCard(data as SrsCardRow);
}

export function getSrsErrorMessage(error: unknown, fallback: string) {
  return getErrorMessage(error, fallback);
}
