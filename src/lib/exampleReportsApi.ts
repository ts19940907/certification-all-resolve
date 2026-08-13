import { supabase } from './supabase';
import { getErrorMessage } from './certificationsApi';
import type {
  ExampleContentReport,
  ReportTarget,
} from '../types/exampleReport';

type ReportRow = {
  id: string;
  example_id: string;
  example_title: string;
  certification_id: string | null;
  certification_name: string;
  reporter_user_id: string;
  target: string;
  message: string;
  status: string;
  admin_response: string | null;
  resolved_at: string | null;
  created_at: string;
};

function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function mapReport(row: ReportRow): ExampleContentReport {
  return {
    id: row.id,
    exampleId: row.example_id,
    exampleTitle: row.example_title,
    certificationId: row.certification_id,
    certificationName: row.certification_name ?? '',
    reporterUserId: row.reporter_user_id,
    target: row.target as ReportTarget,
    message: row.message,
    status: row.status as ExampleContentReport['status'],
    adminResponse: row.admin_response,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    createdAtLabel: formatCreatedAt(row.created_at),
  };
}

export async function fetchIsAdministrator(): Promise<boolean> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return false;
  }

  const { data, error } = await supabase
    .from('users')
    .select('is_administrator')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    console.error('[reports] is_administrator', error);
    throw error;
  }

  return Boolean(data?.is_administrator);
}

export async function submitExampleContentReport(args: {
  exampleId: string;
  exampleTitle: string;
  certificationId: string | null;
  certificationName: string;
  target: ReportTarget;
  message: string;
}): Promise<void> {
  const message = args.message.trim();
  if (!message) {
    throw new Error('連絡内容を入力してください。');
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    throw new Error('ログインが必要です。');
  }

  const { error } = await supabase.from('example_content_reports').insert({
    example_id: args.exampleId,
    example_title: args.exampleTitle.trim() || '無題の例題',
    certification_id: args.certificationId,
    certification_name: args.certificationName.trim(),
    reporter_user_id: user.id,
    target: args.target,
    message,
    status: 'open',
  });

  if (error) {
    console.error('[reports] insert', error);
    throw error;
  }

  // 管理者へのメール通知は追加費用なしの手段が整い次第、ここで Edge Function 等に接続する予定
}

export async function fetchExampleContentReports(): Promise<
  ExampleContentReport[]
> {
  const { data, error } = await supabase
    .from('example_content_reports')
    .select(
      `
      id,
      example_id,
      example_title,
      certification_id,
      certification_name,
      reporter_user_id,
      target,
      message,
      status,
      admin_response,
      resolved_at,
      created_at
    `,
    )
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[reports] fetch', error);
    throw error;
  }

  return ((data ?? []) as ReportRow[]).map(mapReport);
}

/** 対応内容を保存し、報告者へアプリ内通知を送って対応済にする */
export async function resolveExampleContentReport(args: {
  reportId: string;
  adminResponse: string;
}): Promise<void> {
  const adminResponse = args.adminResponse.trim();
  if (!adminResponse) {
    throw new Error('対応内容を入力してください。');
  }

  const { error } = await supabase.rpc('resolve_example_content_report', {
    p_report_id: args.reportId,
    p_admin_response: adminResponse,
  });

  if (error) {
    console.error('[reports] resolve', error);
    throw error;
  }
}

export async function reopenExampleContentReport(
  reportId: string,
): Promise<void> {
  const { error } = await supabase.rpc('reopen_example_content_report', {
    p_report_id: reportId,
  });

  if (error) {
    console.error('[reports] reopen', error);
    throw error;
  }
}

export function getReportErrorMessage(error: unknown, fallback: string) {
  return getErrorMessage(error, fallback);
}
