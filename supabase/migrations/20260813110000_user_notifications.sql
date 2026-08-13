-- 報告への対応コメント + ユーザー通知（ベル用）

alter table public.example_content_reports
  add column if not exists admin_response text;

alter table public.example_content_reports
  add column if not exists resolved_at timestamptz;

comment on column public.example_content_reports.admin_response is
  '管理者が対応済にするときに入力する返信内容。報告者の通知に載る';
comment on column public.example_content_reports.resolved_at is
  '対応済にした日時';

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  kind text not null default 'example_report_resolved',
  title text not null,
  body text not null,
  example_id uuid references public.examples (id) on delete set null,
  example_title text not null default '',
  certification_id uuid references public.certifications (id) on delete set null,
  report_id uuid references public.example_content_reports (id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint user_notifications_kind_check
    check (kind in ('example_report_resolved')),
  constraint user_notifications_body_check
    check (char_length(trim(body)) > 0)
);

create index if not exists user_notifications_user_created_idx
  on public.user_notifications (user_id, created_at desc);

create index if not exists user_notifications_user_unread_idx
  on public.user_notifications (user_id)
  where read_at is null;

comment on table public.user_notifications is
  'ユーザー向けアプリ内通知。誤り連絡への対応結果など';

alter table public.user_notifications enable row level security;

drop policy if exists user_notifications_select_own on public.user_notifications;
create policy user_notifications_select_own
  on public.user_notifications for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists user_notifications_update_own on public.user_notifications;
create policy user_notifications_update_own
  on public.user_notifications for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists user_notifications_insert_admin on public.user_notifications;
create policy user_notifications_insert_admin
  on public.user_notifications for insert
  to authenticated
  with check (public.is_administrator());

-- 管理者が対応済にする: 報告更新 + 報告者への通知を原子的に行う
create or replace function public.resolve_example_content_report(
  p_report_id uuid,
  p_admin_response text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.example_content_reports%rowtype;
  v_response text := trim(both from coalesce(p_admin_response, ''));
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;

  if not public.is_administrator() then
    raise exception '管理者のみ実行できます';
  end if;

  if char_length(v_response) = 0 then
    raise exception '対応内容を入力してください';
  end if;

  select * into r
  from public.example_content_reports
  where id = p_report_id
  for update;

  if not found then
    raise exception '問い合わせが見つかりません';
  end if;

  if r.status = 'resolved' then
    raise exception 'すでに対応済です';
  end if;

  update public.example_content_reports
  set
    status = 'resolved',
    admin_response = v_response,
    resolved_at = now()
  where id = p_report_id;

  insert into public.user_notifications (
    user_id,
    kind,
    title,
    body,
    example_id,
    example_title,
    certification_id,
    report_id
  ) values (
    r.reporter_user_id,
    'example_report_resolved',
    '誤り連絡への対応',
    v_response,
    r.example_id,
    r.example_title,
    r.certification_id,
    r.id
  );
end;
$$;

revoke all on function public.resolve_example_content_report(uuid, text) from public;
grant execute on function public.resolve_example_content_report(uuid, text) to authenticated;

create or replace function public.reopen_example_content_report(
  p_report_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;

  if not public.is_administrator() then
    raise exception '管理者のみ実行できます';
  end if;

  update public.example_content_reports
  set
    status = 'open',
    admin_response = null,
    resolved_at = null
  where id = p_report_id;

  if not found then
    raise exception '問い合わせが見つかりません';
  end if;
end;
$$;

revoke all on function public.reopen_example_content_report(uuid) from public;
grant execute on function public.reopen_example_content_report(uuid) to authenticated;
