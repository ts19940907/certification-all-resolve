import { supabase } from './supabase';
import type { Certification } from '../types/certification';

type UserCertRow = {
  id: string;
  is_archive: boolean;
  certification:
    | { id: string; name: string }
    | { id: string; name: string }[]
    | null;
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
        name
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

export async function createCertification(name: string): Promise<Certification> {
  await ensureCurrentUserRow();

  const { data, error } = await supabase.rpc('create_certification', {
    p_name: name.trim(),
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
  };

  return {
    id: row.id,
    name: row.name,
    isArchive: row.isArchive,
    userCertificationId: row.userCertificationId,
  };
}

export async function renameCertification(
  certificationId: string,
  name: string,
): Promise<void> {
  const canRename = await canRenameCertification(certificationId);
  if (!canRename) {
    throw new Error(
      '例題または履歴がある資格は改名できません。中身を空にすると改名できます。',
    );
  }

  const { error } = await supabase
    .from('certifications')
    .update({ name: name.trim() })
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
  const [{ count: exampleCount, error: exampleError }, { count: historyCount, error: historyError }] =
    await Promise.all([
      supabase
        .from('examples')
        .select('id', { count: 'exact', head: true })
        .eq('certification_id', certificationId),
      supabase
        .from('histories')
        .select('id', { count: 'exact', head: true })
        .eq('certification_id', certificationId),
    ]);

  if (exampleError) {
    console.error('[certifications] example count', exampleError);
    throw exampleError;
  }
  if (historyError) {
    console.error('[certifications] history count', historyError);
    throw historyError;
  }

  return (exampleCount ?? 0) === 0 && (historyCount ?? 0) === 0;
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
