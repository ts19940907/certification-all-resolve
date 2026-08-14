import { supabase } from './supabase';
import type { UserSettings } from '../types/userSettings';

type UsersSettingsRow = {
  mail_address: string;
  prompt_bank_import_after_exam: boolean;
};

function mapSettings(row: UsersSettingsRow): UserSettings {
  return {
    mailAddress: row.mail_address,
    promptBankImportAfterExam: row.prompt_bank_import_after_exam,
  };
}

export function getSettingsErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (
    typeof error === 'object' &&
    error &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string' &&
    (error as { message: string }).message.trim()
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
}

async function requireUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) throw error;
  if (!user) throw new Error('ログインが必要です。');
  return user;
}

export async function fetchUserSettings(): Promise<UserSettings> {
  const user = await requireUserId();
  const { data, error } = await supabase
    .from('users')
    .select('mail_address, prompt_bank_import_after_exam')
    .eq('id', user.id)
    .single();

  if (error) throw error;
  const row = data as UsersSettingsRow;

  // メール変更確定後、トリガー前に開いた場合の保険
  const authEmail = user.email?.trim() ?? '';
  if (authEmail && authEmail !== row.mail_address) {
    const { error: syncError } = await supabase
      .from('users')
      .update({ mail_address: authEmail })
      .eq('id', user.id);
    if (!syncError) {
      return {
        mailAddress: authEmail,
        promptBankImportAfterExam: row.prompt_bank_import_after_exam,
      };
    }
  }

  return mapSettings(row);
}

export async function updatePromptBankImportAfterExam(
  enabled: boolean,
): Promise<void> {
  const user = await requireUserId();
  const { error } = await supabase
    .from('users')
    .update({ prompt_bank_import_after_exam: enabled })
    .eq('id', user.id);
  if (error) throw error;
}

export async function changeEmail(nextEmail: string): Promise<void> {
  const trimmed = nextEmail.trim();
  if (!trimmed) {
    throw new Error('メールアドレスを入力してください。');
  }

  const user = await requireUserId();
  const current = user.email?.trim().toLowerCase() ?? '';
  if (trimmed.toLowerCase() === current) {
    throw new Error('現在と同じメールアドレスです。');
  }

  const { data: allowed, error: allowError } = await supabase.rpc(
    'is_email_allowed',
    { check_email: trimmed },
  );
  if (allowError) throw allowError;
  if (!allowed) {
    throw new Error('このメールアドレスは登録を許可されていません。');
  }

  const { error } = await supabase.auth.updateUser({ email: trimmed });
  if (error) throw error;
}

export async function changePassword(params: {
  currentPassword: string;
  nextPassword: string;
}): Promise<void> {
  const currentPassword = params.currentPassword;
  const nextPassword = params.nextPassword;

  if (currentPassword.length < 6) {
    throw new Error('現在のパスワードを入力してください。');
  }
  if (nextPassword.length < 6) {
    throw new Error('新しいパスワードは6文字以上にしてください。');
  }
  if (currentPassword === nextPassword) {
    throw new Error('現在と同じパスワードです。');
  }

  const user = await requireUserId();
  const email = user.email?.trim();
  if (!email) {
    throw new Error('メールアドレスが取得できませんでした。');
  }

  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (reauthError) {
    throw new Error('現在のパスワードが正しくありません。');
  }

  const { error } = await supabase.auth.updateUser({ password: nextPassword });
  if (error) throw error;
}
