import { supabase } from './supabase';
import { getErrorMessage } from './certificationsApi';
import type {
  AnalysisPeriod,
  AnalysisSnapshot,
  CategoryUnderstanding,
  CertificationCategory,
  CertificationKeyword,
  KeywordProgress,
} from '../types/analysis';
import type { ExampleBatchDetail } from '../types/history';

function mapCategory(row: {
  id: string;
  certification_id: string;
  name: string;
  sort_order: number;
}): CertificationCategory {
  return {
    id: row.id,
    certificationId: row.certification_id,
    name: row.name,
    sortOrder: row.sort_order,
  };
}

function mapKeyword(row: {
  id: string;
  certification_id: string;
  name: string;
  sort_order: number;
}): CertificationKeyword {
  return {
    id: row.id,
    certificationId: row.certification_id,
    name: row.name,
    sortOrder: row.sort_order,
  };
}

export async function fetchCertificationCategories(
  certificationId: string,
): Promise<CertificationCategory[]> {
  const { data, error } = await supabase
    .from('certification_categories')
    .select('id, certification_id, name, sort_order')
    .eq('certification_id', certificationId)
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('[analysis] categories', error);
    throw error;
  }
  return (data ?? []).map(mapCategory);
}

export async function fetchCertificationKeywords(
  certificationId: string,
): Promise<CertificationKeyword[]> {
  const { data, error } = await supabase
    .from('certification_keywords')
    .select('id, certification_id, name, sort_order')
    .eq('certification_id', certificationId)
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('[analysis] keywords', error);
    throw error;
  }
  return (data ?? []).map(mapKeyword);
}

export async function ensureCertificationMasters(
  certificationId: string,
): Promise<void> {
  const { data, error } = await supabase.functions.invoke(
    'seed-cert-analysis',
    {
      body: { mode: 'ensure_masters', certificationId },
    },
  );
  if (error) {
    console.error('[analysis] ensure_masters invoke', error);
    throw new Error(
      getErrorMessage(error, 'カテゴリ／キーワードマスタの生成に失敗しました。'),
    );
  }
  const payload = data as { ok?: boolean; error?: string } | null;
  if (payload && payload.ok === false) {
    throw new Error(payload.error ?? 'マスタの生成に失敗しました。');
  }
}

/** 既存データ向け。画面トリガーなし。Cursor／ターミナルから一度実行する想定 */
export async function backfillOwnedCertAnalysis(): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke(
    'seed-cert-analysis',
    {
      body: { mode: 'backfill_owned' },
    },
  );
  if (error) {
    console.error('[analysis] backfill_owned', error);
    throw error;
  }
  return data;
}

function startOfWeekMonday(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay(); // 0 Sun .. 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function periodRange(period: AnalysisPeriod): { from: Date | null; to: Date } {
  const to = new Date();
  if (period === 'all') return { from: null, to };
  if (period === 'month') return { from: startOfMonth(to), to };
  return { from: startOfWeekMonday(to), to };
}

function periodLabel(period: AnalysisPeriod): string {
  const now = new Date();
  if (period === 'all') return '全体（累積）';
  if (period === 'month') {
    return `${now.getFullYear()}年${now.getMonth() + 1}月`;
  }
  const from = startOfWeekMonday(now);
  const m = from.getMonth() + 1;
  const d = from.getDate();
  return `今週（${m}/${d}〜・月曜始まり）`;
}

function normalizeKeywordKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_\-　]+/g, '')
    .replace(/[（(].*$/, '');
}

export function splitKeywordInputs(raw: string): string[] {
  return raw
    .split(/[,、/\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** 入力キーワードがマスタと整合するか。空入力はチェック対象外（true） */
export function keywordsAlignWithMaster(
  input: string,
  masterNames: string[],
): { ok: true } | { ok: false; unmatched: string[] } {
  const tokens = splitKeywordInputs(input);
  if (tokens.length === 0) return { ok: true };
  if (masterNames.length === 0) {
    return { ok: false, unmatched: tokens };
  }
  const masterKeys = masterNames.map((name) => ({
    name,
    key: normalizeKeywordKey(name),
  }));
  const unmatched: string[] = [];
  for (const token of tokens) {
    const key = normalizeKeywordKey(token);
    if (!key) continue;
    const hit = masterKeys.some(
      (m) => m.key === key || m.key.includes(key) || key.includes(m.key),
    );
    if (!hit) unmatched.push(token);
  }
  if (unmatched.length > 0) return { ok: false, unmatched };
  return { ok: true };
}

function buildCategoryStats(
  categories: CertificationCategory[],
  answers: Array<{ categoryId: string | null; correct: boolean }>,
): CategoryUnderstanding[] {
  return categories.map((cat) => {
    const rows = answers.filter((a) => a.categoryId === cat.id);
    const answeredCount = rows.length;
    const correctCount = rows.filter((r) => r.correct).length;
    return {
      categoryId: cat.id,
      name: cat.name,
      correctCount,
      answeredCount,
      rate:
        answeredCount === 0
          ? null
          : Math.round((correctCount / answeredCount) * 100),
    };
  });
}

function buildKeywordProgress(
  keywords: CertificationKeyword[],
  reviews: Array<{ keyword: string; grade: string }>,
): KeywordProgress {
  const masterKeys = new Map(
    keywords.map((k) => [normalizeKeywordKey(k.name), k.name]),
  );
  const explained = new Set<string>();
  for (const review of reviews) {
    if (review.grade !== 'A' && review.grade !== 'B') continue;
    const key = normalizeKeywordKey(review.keyword);
    const masterName = masterKeys.get(key);
    if (!masterName) continue;
    // also try includes match
    explained.add(masterName);
  }
  // loose match: review contains master or master contains review
  for (const review of reviews) {
    if (review.grade !== 'A' && review.grade !== 'B') continue;
    const rk = normalizeKeywordKey(review.keyword);
    if (!rk) continue;
    for (const [mk, name] of masterKeys) {
      if (explained.has(name)) continue;
      if (rk === mk || rk.includes(mk) || mk.includes(rk)) {
        explained.add(name);
      }
    }
  }
  const totalCount = keywords.length;
  const explainedCount = explained.size;
  return {
    explainedCount,
    totalCount,
    rate:
      totalCount === 0
        ? null
        : Math.round((explainedCount / totalCount) * 100),
    explainedNames: [...explained],
  };
}

async function loadExampleCategoryMap(
  certificationId: string,
): Promise<Map<string, string | null>> {
  const { data, error } = await supabase
    .from('examples')
    .select('id, category_id')
    .eq('certification_id', certificationId);
  if (error) throw error;
  const map = new Map<string, string | null>();
  for (const row of data ?? []) {
    map.set(row.id as string, (row.category_id as string | null) ?? null);
  }
  return map;
}

export async function fetchCumulativeAnalysis(
  certificationId: string,
  period: AnalysisPeriod,
): Promise<AnalysisSnapshot> {
  const [categories, keywords] = await Promise.all([
    fetchCertificationCategories(certificationId),
    fetchCertificationKeywords(certificationId),
  ]);

  const { from, to } = periodRange(period);
  let batchQuery = supabase
    .from('histories')
    .select('kind, performed_at, detail')
    .eq('certification_id', certificationId)
    .in('kind', ['example_batch', 'exam'])
    .lte('performed_at', to.toISOString())
    .order('performed_at', { ascending: false });

  if (from) {
    batchQuery = batchQuery.gte('performed_at', from.toISOString());
  }

  const [{ data: batchRows, error: batchError }, { data: kwRows, error: kwError }] =
    await Promise.all([
      batchQuery,
      supabase
        .from('histories')
        .select('detail')
        .eq('certification_id', certificationId)
        .eq('kind', 'keyword_review'),
    ]);

  if (batchError) {
    console.error('[analysis] batch histories', batchError);
    throw batchError;
  }
  if (kwError) {
    console.error('[analysis] keyword histories', kwError);
    throw kwError;
  }

  const categoryMap = await loadExampleCategoryMap(certificationId);
  const answers: Array<{ categoryId: string | null; correct: boolean }> = [];

  for (const row of batchRows ?? []) {
    const detail = row.detail as ExampleBatchDetail | null;
    if (!detail || !Array.isArray(detail.results)) continue;
    for (const item of detail.results) {
      answers.push({
        categoryId: categoryMap.get(item.example_id) ?? null,
        correct: Boolean(item.correct),
      });
    }
  }

  const reviews: Array<{ keyword: string; grade: string }> = [];
  for (const row of kwRows ?? []) {
    const detail = row.detail as {
      keyword?: string;
      grade?: string;
    } | null;
    if (!detail?.keyword || !detail?.grade) continue;
    reviews.push({
      keyword: detail.keyword,
      grade: String(detail.grade).toUpperCase(),
    });
  }

  return {
    period,
    periodLabel: periodLabel(period),
    categories: buildCategoryStats(categories, answers),
    keywordProgress: buildKeywordProgress(keywords, reviews),
  };
}

export function buildSessionCategoryAnalysis(
  categories: CertificationCategory[],
  detail: ExampleBatchDetail,
  exampleCategoryMap: Map<string, string | null>,
): CategoryUnderstanding[] {
  const answers = detail.results.map((item) => ({
    categoryId: exampleCategoryMap.get(item.example_id) ?? null,
    correct: item.correct,
  }));
  return buildCategoryStats(categories, answers);
}

export async function fetchExampleCategoryMap(
  certificationId: string,
): Promise<Map<string, string | null>> {
  return loadExampleCategoryMap(certificationId);
}

export function getAnalysisErrorMessage(error: unknown, fallback: string) {
  return getErrorMessage(error, fallback);
}
