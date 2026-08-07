import { supabase } from './supabase';
import { getErrorMessage } from './certificationsApi';
import type {
  ExampleAiChatDetail,
  HistoryChatMessage,
  HistorySummary,
} from '../types/history';

type HistoryRow = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  performed_at: string;
  detail: unknown;
};

function formatPerformedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function parseAiChatDetail(raw: unknown): ExampleAiChatDetail | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const exampleId = String(obj.example_id ?? '').trim();
  if (!exampleId) return null;
  const messagesRaw = Array.isArray(obj.messages) ? obj.messages : [];
  const messages: HistoryChatMessage[] = [];
  for (const item of messagesRaw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const role =
      row.role === 'assistant' ? 'assistant' : row.role === 'user' ? 'user' : null;
    const text = String(row.text ?? '').trim();
    const id = String(row.id ?? '').trim() || `m-${messages.length}`;
    if (!role || !text) continue;
    messages.push({ id, role, text });
  }
  return { example_id: exampleId, messages };
}

function mapHistory(row: HistoryRow): HistorySummary {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    performedAt: formatPerformedAt(row.performed_at),
    performedAtRaw: row.performed_at,
    detail:
      row.kind === 'example_ai_chat' ? parseAiChatDetail(row.detail) : null,
  };
}

export async function fetchHistories(
  certificationId: string,
): Promise<HistorySummary[]> {
  const { data, error } = await supabase
    .from('histories')
    .select('id, kind, title, summary, performed_at, detail')
    .eq('certification_id', certificationId)
    .order('performed_at', { ascending: false });

  if (error) {
    console.error('[histories] fetch', error);
    throw error;
  }

  return ((data ?? []) as HistoryRow[]).map(mapHistory);
}

export function buildAiChatHistoryTitle(exampleTitle: string): string {
  const trimmed = exampleTitle.trim();
  return trimmed
    ? `例題についてAIに質問 — ${trimmed}`
    : '例題についてAIに質問';
}

export function buildAiChatHistorySummary(messages: HistoryChatMessage[]): string {
  const count = messages.filter((m) => m.role === 'user').length;
  return `質問 ${count}件`;
}

export async function insertAiChatHistory(args: {
  certificationId: string;
  exampleId: string;
  exampleTitle: string;
  messages: HistoryChatMessage[];
}): Promise<string> {
  const detail: ExampleAiChatDetail = {
    example_id: args.exampleId,
    messages: args.messages,
  };
  const { data, error } = await supabase
    .from('histories')
    .insert({
      certification_id: args.certificationId,
      kind: 'example_ai_chat',
      title: buildAiChatHistoryTitle(args.exampleTitle),
      summary: buildAiChatHistorySummary(args.messages),
      detail,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[histories] insert ai chat', error);
    throw error;
  }

  return data.id as string;
}

export async function updateAiChatHistory(args: {
  historyId: string;
  exampleId: string;
  exampleTitle: string;
  messages: HistoryChatMessage[];
}): Promise<void> {
  const detail: ExampleAiChatDetail = {
    example_id: args.exampleId,
    messages: args.messages,
  };
  const { error } = await supabase
    .from('histories')
    .update({
      title: buildAiChatHistoryTitle(args.exampleTitle),
      summary: buildAiChatHistorySummary(args.messages),
      detail,
      performed_at: new Date().toISOString(),
    })
    .eq('id', args.historyId);

  if (error) {
    console.error('[histories] update ai chat', error);
    throw error;
  }
}

export async function exampleExists(exampleId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('examples')
    .select('id')
    .eq('id', exampleId)
    .maybeSingle();

  if (error) {
    console.error('[histories] example exists', error);
    throw error;
  }

  return data != null;
}

export function getHistoryErrorMessage(error: unknown, fallback: string) {
  return getErrorMessage(error, fallback);
}
