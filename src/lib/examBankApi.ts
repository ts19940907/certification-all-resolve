import { FunctionsHttpError, FunctionsRelayError, FunctionsFetchError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { getErrorMessage } from './certificationsApi';

export type ExamBankAnswerTypes = {
  single: number;
  multi: number;
  total: number;
  multiRatio: number;
  multiTarget: number;
  multiMinRatio: number;
  multiMaxRatio: number;
  inTargetRange: boolean;
};

export type ExamBankDomainProgress = {
  domain: string;
  label: string;
  have: number;
  need: number;
  remaining: number;
};

export type ExamBankStepResult = {
  complete: boolean;
  created: number;
  totalHave: number;
  totalRemaining: number;
  targetTotal: number;
  progress: ExamBankDomainProgress[];
  status: string;
  warning?: string | null;
  answerTypes?: ExamBankAnswerTypes | null;
};

type EdgeOk = {
  ok: true;
  complete?: boolean;
  created?: number;
  deleted?: number;
  totalHave?: number;
  totalRemaining?: number;
  targetTotal?: number;
  progress?: ExamBankDomainProgress[];
  status?: string;
  message?: string | null;
  warning?: string | null;
  answerTypes?: ExamBankAnswerTypes;
};

type EdgeFail = {
  ok: false;
  error?: string;
  issues?: string[];
  totalHave?: number;
  totalRemaining?: number;
  targetTotal?: number;
};

const TARGET_TOTAL_FALLBACK = 150;

export function getExamBankErrorMessage(error: unknown, fallback: string) {
  return getErrorMessage(error, fallback);
}

function formatEdgeFail(fail: EdgeFail | null | undefined, fallback: string) {
  if (!fail) return fallback;
  const issues =
    fail.issues && fail.issues.length > 0
      ? `（${fail.issues.join(' / ')}）`
      : '';
  const progress =
    typeof fail.totalHave === 'number' &&
    typeof fail.targetTotal === 'number' &&
    fail.targetTotal > 0
      ? ` 進捗: ${fail.totalHave}/${fail.targetTotal}。`
      : typeof fail.totalHave === 'number' &&
          typeof fail.totalRemaining === 'number'
        ? ` 進捗: ${fail.totalHave}問済み（残り${fail.totalRemaining}）。`
        : '';
  const base = fail.error?.trim() || fallback;
  return `${base}${issues}${progress} 再試行で続きから再開できます。`;
}

async function readFunctionsErrorBody(error: unknown): Promise<EdgeFail | null> {
  if (!(error instanceof FunctionsHttpError)) return null;
  try {
    const context = error.context as Response | undefined;
    if (!context || typeof context.json !== 'function') return null;
    // Response body は1回しか読めないので clone
    const cloned =
      typeof context.clone === 'function' ? context.clone() : context;
    const body = (await cloned.json()) as EdgeFail;
    if (body && typeof body === 'object') return body;
  } catch (readError) {
    console.error('[exam-bank] read error body', readError);
  }
  return null;
}

function mapInvokeTransportError(error: unknown): string {
  if (error instanceof FunctionsFetchError) {
    return '試験問題用のサーバー関数に接続できませんでした。ネットワークを確認して再試行してください。';
  }
  if (error instanceof FunctionsRelayError) {
    return '試験問題用のサーバー関数への中継に失敗しました。しばらくしてから再試行してください。';
  }
  if (error instanceof FunctionsHttpError) {
    return '試験問題の生成でサーバーエラーが発生しました。再試行で続きから再開できます。';
  }
  if (error instanceof Error) {
    if (error.message.includes('Failed to send')) {
      return '試験問題用のサーバー関数に接続できませんでした。ログイン状態とネットワークを確認し、ページを再読み込みして再試行してください。';
    }
    if (error.message.includes('non-2xx')) {
      return '試験問題の生成でサーバーエラーが発生しました。再試行で続きから再開できます。';
    }
    return error.message;
  }
  return '試験問題の処理に失敗しました';
}

async function invokeExamBank(
  certificationId: string,
  mode: 'status' | 'reset' | 'generate' | 'rebalance_multi',
): Promise<EdgeOk> {
  const { data, error } = await supabase.functions.invoke('generate-exam-bank', {
    body: { certification_id: certificationId, mode },
  });

  // non-2xx でも data に JSON が入ることがある
  if (data && typeof data === 'object' && (data as EdgeFail).ok === false) {
    throw new Error(
      formatEdgeFail(data as EdgeFail, '試験問題の処理に失敗しました'),
    );
  }

  if (error) {
    console.error('[exam-bank] invoke', mode, error);
    const body = await readFunctionsErrorBody(error);
    if (body) {
      throw new Error(
        formatEdgeFail(body, mapInvokeTransportError(error)),
      );
    }
    // data が成功形なら優先（稀なケース）
    if (data && typeof data === 'object' && (data as EdgeOk).ok === true) {
      return data as EdgeOk;
    }
    throw new Error(mapInvokeTransportError(error));
  }

  const payload = data as EdgeOk | EdgeFail;
  if (!payload || payload.ok !== true) {
    throw new Error(
      formatEdgeFail(payload as EdgeFail, '試験問題の処理に失敗しました'),
    );
  }
  return payload;
}

export async function fetchExamBankStatus(certificationId: string): Promise<{
  status: string;
  message: string | null;
  totalHave: number;
  totalRemaining: number;
  targetTotal: number;
  progress: ExamBankDomainProgress[];
  answerTypes: ExamBankAnswerTypes | null;
}> {
  const payload = await invokeExamBank(certificationId, 'status');
  return {
    status: payload.status ?? 'none',
    message: payload.message ?? null,
    totalHave: payload.totalHave ?? 0,
    totalRemaining: payload.totalRemaining ?? 0,
    targetTotal: payload.targetTotal ?? TARGET_TOTAL_FALLBACK,
    progress: payload.progress ?? [],
    answerTypes: payload.answerTypes ?? null,
  };
}

/** 複数選択比率不足時: 単一選択を削除して生成枠を空ける */
export async function rebalanceExamBankForMulti(
  certificationId: string,
): Promise<{
  deleted: number;
  totalHave: number;
  totalRemaining: number;
  answerTypes: ExamBankAnswerTypes | null;
  message: string | null;
}> {
  const payload = await invokeExamBank(certificationId, 'rebalance_multi');
  return {
    deleted: payload.deleted ?? 0,
    totalHave: payload.totalHave ?? 0,
    totalRemaining: payload.totalRemaining ?? 0,
    answerTypes: payload.answerTypes ?? null,
    message: payload.message ?? null,
  };
}

/** パイロット含む既存共有バンクを削除 */
export async function resetExamBank(
  certificationId: string,
): Promise<{ deleted: number }> {
  const payload = await invokeExamBank(certificationId, 'reset');
  return { deleted: payload.deleted ?? 0 };
}

/** 最大5問まで生成（1呼び出し） */
export async function generateExamBankBatchStep(
  certificationId: string,
): Promise<ExamBankStepResult> {
  const payload = await invokeExamBank(certificationId, 'generate');
  return {
    complete: Boolean(payload.complete),
    created: payload.created ?? 0,
    totalHave: payload.totalHave ?? 0,
    totalRemaining: payload.totalRemaining ?? 0,
    targetTotal: payload.targetTotal ?? TARGET_TOTAL_FALLBACK,
    progress: payload.progress ?? [],
    status: payload.status ?? 'generating',
    warning: payload.warning ?? null,
    answerTypes: payload.answerTypes ?? null,
  };
}

/**
 * 150問までバッチ生成を繰り返す。
 * 途中失敗時はそれまでの進捗を返す（再実行で再開可）。
 */
export async function runExamBankFullGeneration(
  certificationId: string,
  onProgress?: (step: ExamBankStepResult) => void,
): Promise<ExamBankStepResult> {
  let last: ExamBankStepResult | null = null;
  // 150/5 = 30 回 + 余裕
  for (let i = 0; i < 40; i += 1) {
    const step = await generateExamBankBatchStep(certificationId);
    last = step;
    onProgress?.(step);
    if (step.complete || step.totalRemaining <= 0) {
      return step;
    }
    if (step.created === 0) {
      throw new Error(
        (step.warning
          ? `${step.warning} 進捗: ${step.totalHave}/${step.targetTotal}。`
          : `このバッチでは問題を追加できませんでした。進捗: ${step.totalHave}/${step.targetTotal}。`) +
          '再試行で続きから再開できます。',
      );
    }
  }
  if (!last) {
    throw new Error('試験問題の生成を開始できませんでした');
  }
  return last;
}

/** 共有バンクから試験用に抽選（既定75問、不足時は全件） */
export async function fetchBankExampleIdsForExam(
  certificationId: string,
  take = 75,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('examples')
    .select('id, domain, created_at')
    .eq('certification_id', certificationId)
    .is('user_id', null)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[exam-bank] fetch ids', error);
    throw error;
  }

  const ids = (data ?? []).map((row) => row.id as string);
  if (ids.length <= take) return ids;

  // 簡易シャッフルして take 件
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = ids[i]!;
    ids[i] = ids[j]!;
    ids[j] = tmp;
  }
  return ids.slice(0, take);
}
