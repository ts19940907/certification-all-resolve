import { supabase } from './supabase';
import { getErrorMessage } from './certificationsApi';
import type { ExampleSummary } from '../types/example';

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

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
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

    // data が取れない場合（ネットワーク等）は再試行
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
