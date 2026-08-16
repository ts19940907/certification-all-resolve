import { supabase } from './supabase';
import type { Certification } from '../types/certification';

type CertFields = {
  id: string;
  name: string;
  question_format: number | null;
  choice_min: number | null;
  choice_max: number | null;
  answer_max: number | null;
};

type UserCertRow = {
  id: string;
  is_archive: boolean;
  certification: CertFields | CertFields[] | null;
};

function mapRow(row: UserCertRow): Certification | null {
  const cert = Array.isArray(row.certification)
    ? row.certification[0]
    : row.certification;
  if (!cert) return null;
  return {
    id: cert.id,
    name: cert.name,
    isArchive: row.is_archive,
    userCertificationId: row.id,
    questionFormat: cert.question_format ?? 0,
    choiceMin: cert.choice_min,
    choiceMax: cert.choice_max,
    answerMax: cert.answer_max,
  };
}

export async function ensureCurrentUserRow() {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) {
    console.error('[certifications] getUser', userError);
    throw userError;
  }
  const user = userData.user;
  if (!user) {
    throw new Error('ログインが必要です');
  }

  const { error } = await supabase.rpc('ensure_current_user');
  if (error) {
    console.error('[certifications] ensure_current_user', error);
    throw error;
  }

  return user;
}

export async function fetchCertifications(): Promise<Certification[]> {
  const user = await ensureCurrentUserRow();

  const { data, error } = await supabase
    .from('user_certifications')
    .select(
      `
      id,
      is_archive,
      certification:certifications (
        id,
        name,
        question_format,
        choice_min,
        choice_max,
        answer_max
      )
    `,
    )
    .eq('user_id', user.id)
    .order('registered_date', { ascending: false });

  if (error) {
    console.error('[certifications] fetch', error);
    throw error;
  }

  return ((data ?? []) as UserCertRow[])
    .map(mapRow)
    .filter((item): item is Certification => item != null);
}

export type CreateCertificationInput = {
  name: string;
  questionFormat: number;
  choiceMin: number | null;
  choiceMax: number | null;
  answerMax: number | null;
};

export type ValidatedCertificationCandidate = {
  officialName: string;
  summary: string;
  officialUrl: string;
  questionFormat: number;
  choiceMin: number | null;
  choiceMax: number | null;
  answerMax: number | null;
};

type ValidateSuccess = {
  ok: true;
  candidate: {
    official_name: string;
    summary: string;
    official_url: string;
    question_format: number;
    choice_min: number | null;
    choice_max: number | null;
    answer_max: number | null;
  };
};

type ValidateFailure = {
  ok: false;
  error_code?: string;
  error?: string;
};

export async function validateCertificationQuery(
  query: string,
): Promise<ValidatedCertificationCandidate> {
  await ensureCurrentUserRow();

  const { data, error } = await supabase.functions.invoke(
    'validate-certification',
    { body: { query: query.trim() } },
  );

  const payload = (data ?? null) as ValidateSuccess | ValidateFailure | null;

  if (payload && payload.ok === true) {
    return {
      officialName: payload.candidate.official_name,
      summary: payload.candidate.summary,
      officialUrl: payload.candidate.official_url,
      questionFormat: payload.candidate.question_format,
      choiceMin: payload.candidate.choice_min,
      choiceMax: payload.candidate.choice_max,
      answerMax: payload.candidate.answer_max,
    };
  }

  if (payload && payload.ok === false && payload.error) {
    throw new Error(payload.error);
  }

  if (error) {
    console.error('[certifications] validate invoke', error);
    throw new Error(
      getErrorMessage(error, '資格の照合に失敗しました。時間をおいて再度お試しください。'),
    );
  }

  throw new Error('資格の照合に失敗しました。時間をおいて再度お試しください。');
}

export async function createCertification(
  input: CreateCertificationInput,
): Promise<Certification> {
  await ensureCurrentUserRow();

  const { data, error } = await supabase.rpc('create_certification', {
    p_name: input.name.trim(),
    p_question_format: input.questionFormat,
    p_choice_min: input.choiceMin,
    p_choice_max: input.choiceMax,
    p_answer_max: input.answerMax,
  });

  if (error) {
    console.error('[certifications] create', error);
    throw error;
  }

  const row = data as {
    id: string;
    userCertificationId: string;
    name: string;
    isArchive: boolean;
    questionFormat?: number;
    choiceMin?: number | null;
    choiceMax?: number | null;
    answerMax?: number | null;
  };

  return {
    id: row.id,
    name: row.name,
    isArchive: row.isArchive,
    userCertificationId: row.userCertificationId,
    questionFormat: row.questionFormat ?? input.questionFormat,
    choiceMin: row.choiceMin ?? input.choiceMin,
    choiceMax: row.choiceMax ?? input.choiceMax,
    answerMax: row.answerMax ?? input.answerMax,
  };
}

export async function renameCertification(
  certificationId: string,
  input: CreateCertificationInput,
): Promise<void> {
  const canRename = await canRenameCertification(certificationId);
  if (!canRename) {
    throw new Error(
      '例題・履歴がある、共有バンクがある、または他のユーザーが利用中の資格は改名できません。',
    );
  }

  const format = input.questionFormat & 7;
  if (format === 0) {
    throw new Error('対応する出題形式が存在しないため、作成できません');
  }

  const { error } = await supabase
    .from('certifications')
    .update({
      name: input.name.trim(),
      question_format: format,
      choice_min: input.choiceMin,
      choice_max: input.choiceMax,
      answer_max: input.answerMax,
    })
    .eq('id', certificationId);

  if (error) {
    console.error('[certifications] rename', error);
    throw error;
  }
}

export async function setCertificationArchived(
  userCertificationId: string,
  isArchive: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('user_certifications')
    .update({ is_archive: isArchive })
    .eq('id', userCertificationId);

  if (error) {
    console.error('[certifications] archive', error);
    throw error;
  }
}

export async function canRenameCertification(
  certificationId: string,
): Promise<boolean> {
  const user = await ensureCurrentUserRow();

  const [
    { count: otherUserCount, error: otherUserError },
    { count: bankCount, error: bankError },
    { count: exampleCount, error: exampleError },
    { count: historyCount, error: historyError },
  ] = await Promise.all([
    supabase
      .from('user_certifications')
      .select('id', { count: 'exact', head: true })
      .eq('certification_id', certificationId)
      .neq('user_id', user.id),
    supabase
      .from('examples')
      .select('id', { count: 'exact', head: true })
      .eq('certification_id', certificationId)
      .is('user_id', null),
    supabase
      .from('examples')
      .select('id', { count: 'exact', head: true })
      .eq('certification_id', certificationId)
      .eq('user_id', user.id),
    supabase
      .from('histories')
      .select('id', { count: 'exact', head: true })
      .eq('certification_id', certificationId)
      .eq('user_id', user.id),
  ]);

  if (otherUserError) {
    console.error('[certifications] other users', otherUserError);
    throw otherUserError;
  }
  if (bankError) {
    console.error('[certifications] bank count', bankError);
    throw bankError;
  }
  if (exampleError) {
    console.error('[certifications] example count', exampleError);
    throw exampleError;
  }
  if (historyError) {
    console.error('[certifications] history count', historyError);
    throw historyError;
  }

  return (
    (otherUserCount ?? 0) === 0 &&
    (bankCount ?? 0) === 0 &&
    (exampleCount ?? 0) === 0 &&
    (historyCount ?? 0) === 0
  );
}

export function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (
    typeof error === 'object' &&
    error &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
}
