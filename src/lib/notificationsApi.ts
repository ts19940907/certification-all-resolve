import { supabase } from './supabase';
import { getErrorMessage } from './certificationsApi';
import type { UserNotification } from '../types/notification';

type NotificationRow = {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  example_id: string | null;
  example_title: string;
  certification_id: string | null;
  report_id: string | null;
  read_at: string | null;
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

function mapNotification(row: NotificationRow): UserNotification {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind as UserNotification['kind'],
    title: row.title,
    body: row.body,
    exampleId: row.example_id,
    exampleTitle: row.example_title ?? '',
    certificationId: row.certification_id,
    reportId: row.report_id,
    readAt: row.read_at,
    createdAt: row.created_at,
    createdAtLabel: formatCreatedAt(row.created_at),
    isUnread: row.read_at == null,
  };
}

export async function fetchUserNotifications(): Promise<UserNotification[]> {
  const { data, error } = await supabase
    .from('user_notifications')
    .select(
      `
      id,
      user_id,
      kind,
      title,
      body,
      example_id,
      example_title,
      certification_id,
      report_id,
      read_at,
      created_at
    `,
    )
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[notifications] fetch', error);
    throw error;
  }

  return ((data ?? []) as NotificationRow[]).map(mapNotification);
}

export async function fetchUnreadNotificationCount(): Promise<number> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;

  const { count, error } = await supabase
    .from('user_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null);

  if (error) {
    console.error('[notifications] unread count', error);
    throw error;
  }

  return count ?? 0;
}

export async function markNotificationRead(
  notificationId: string,
): Promise<void> {
  const { error } = await supabase
    .from('user_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .is('read_at', null);

  if (error) {
    console.error('[notifications] mark read', error);
    throw error;
  }
}

export function getNotificationErrorMessage(error: unknown, fallback: string) {
  return getErrorMessage(error, fallback);
}
