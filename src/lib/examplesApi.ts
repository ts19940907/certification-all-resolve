import { supabase } from './supabase';
import { getErrorMessage } from './certificationsApi';
import type { ExampleDiagram } from '../types/diagram';
import type { ExampleDetail, ExampleSummary, SelectAnswer } from '../types/example';

export type GenerateExampleResult = {
  id: string;
  title: string;
};

type EdgeSuccess = {
  ok: true;
  example: { id: string; title: string };
};

type EdgeFailure = {
  ok: false;
  retryable?: boolean;
  error?: string;
};

type SelectAnswerRow = {
  id: string;
  value: string;
  is_answer: boolean;
  reason: string;
};

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function mapChoice(row: SelectAnswerRow): SelectAnswer {
  return {
    id: row.id,
    value: row.value,
    isAnswer: row.is_answer,
    reason: row.reason ?? '',
  };
}

export async function fetchExamples(
  certificationId: string,
): Promise<ExampleSummary[]> {
  const { data, error } = await supabase
    .from('examples')
    .select('id, title')
    .eq('certification_id', certificationId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[examples] fetch', error);
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
  }));
}

export async function fetchExampleDetail(
  exampleId: string,
): Promise<ExampleDetail> {
  const { data, error } = await supabase
    .from('examples')
    .select(
      `
      id,
      title,
      question,
      answer,
      explanation,
      select_answer (
        id,
        value,
        is_answer,
        reason
      )
    `,
    )
    .eq('id', exampleId)
    .single();

  if (error) {
    console.error('[examples] detail', error);
    throw error;
  }

  const choicesRaw = Array.isArray(data.select_answer)
    ? (data.select_answer as SelectAnswerRow[])
    : data.select_answer
      ? [data.select_answer as SelectAnswerRow]
      : [];

  return {
    id: data.id as string,
    title: data.title as string,
    question: data.question as string,
    answer: (data.answer as string) ?? '',
    explanation: (data.explanation as string) ?? '',
    choices: choicesRaw.map(mapChoice),
  };
}

/** examples を物理削除（RPC）。select_answer も一緒に削除 */
export async function deleteExample(exampleId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_example', {
    p_example_id: exampleId,
  });

  if (error) {
    console.error('[examples] delete', error);
    throw error;
  }
}

/** Fisher–Yates */
export function shuffleChoices<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
  }
  return next;
}

/**
 * おまかせ生成。整合失敗など retryable な場合は成功するまで再試行する。
 * signal でキャンセル可。
 */
export async function generateExampleAuto(args: {
  certificationId: string;
  signal?: AbortSignal;
}): Promise<GenerateExampleResult> {
  const { certificationId, signal } = args;

  while (true) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const { data, error } = await supabase.functions.invoke('generate-example', {
      body: { certification_id: certificationId },
    });

    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const payload = (data ?? null) as EdgeSuccess | EdgeFailure | null;

    if (payload && 'ok' in payload && payload.ok === true) {
      return {
        id: payload.example.id,
        title: payload.example.title,
      };
    }

    if (payload && 'ok' in payload && payload.ok === false) {
      if (payload.retryable === false) {
        throw new Error(payload.error || '例題の生成に失敗しました');
      }
      console.warn('[examples] generate retry', payload.error);
      await sleep(400, signal);
      continue;
    }

    if (error) {
      console.error('[examples] generate invoke', error);
    }
    await sleep(800, signal);
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function getGenerateErrorMessage(error: unknown) {
  if (isAbortError(error)) {
    return '作成をキャンセルしました';
  }
  return getErrorMessage(error, '例題の生成に失敗しました');
}

export function getExampleErrorMessage(error: unknown, fallback: string) {
  return getErrorMessage(error, fallback);
}

type AskEdgeSuccess = {
  ok: true;
  reply: string;
};

type AskEdgeFailure = {
  ok: false;
  error?: string;
};

/** 例題についてAIに質問（直近のやり取りを含む） */
export async function askExampleChat(args: {
  exampleId: string;
  messages: Array<{ role: 'user' | 'assistant'; text: string }>;
}): Promise<string> {
  const { data, error } = await supabase.functions.invoke('ask-example', {
    body: {
      example_id: args.exampleId,
      messages: args.messages,
    },
  });

  const payload = (data ?? null) as AskEdgeSuccess | AskEdgeFailure | null;

  if (payload && 'ok' in payload && payload.ok === true) {
    return payload.reply;
  }

  if (payload && 'ok' in payload && payload.ok === false) {
    throw new Error(payload.error || 'AIへの質問に失敗しました');
  }

  if (error) {
    console.error('[examples] ask-example invoke', error);
    throw error;
  }

  throw new Error('AIへの質問に失敗しました');
}

export function getAskErrorMessage(error: unknown) {
  return getErrorMessage(error, 'AIへの質問に失敗しました');
}

type DiagramEdgeSuccess = {
  ok: true;
  diagram: ExampleDiagram;
};

type DiagramEdgeFailure = {
  ok: false;
  error?: string;
};

/** 例題の図解データを生成 */
export async function generateExampleDiagram(args: {
  exampleId: string;
}): Promise<ExampleDiagram> {
  const { data, error } = await supabase.functions.invoke('diagram-example', {
    body: { example_id: args.exampleId },
  });

  const payload = (data ?? null) as DiagramEdgeSuccess | DiagramEdgeFailure | null;

  if (payload && 'ok' in payload && payload.ok === true) {
    return payload.diagram;
  }

  if (payload && 'ok' in payload && payload.ok === false) {
    throw new Error(payload.error || '図解の作成に失敗しました');
  }

  if (error) {
    console.error('[examples] diagram-example invoke', error);
    throw error;
  }

  throw new Error('図解の作成に失敗しました');
}

export function getDiagramErrorMessage(error: unknown) {
  return getErrorMessage(error, '図解の作成に失敗しました');
}
