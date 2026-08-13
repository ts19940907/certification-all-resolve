-- 管理者フラグ + 例題内容の誤り連絡

alter table public.users
  add column if not exists is_administrator boolean not null default false;

comment on column public.users.is_administrator is
  'true のユーザーのみ管理者画面（問い合わせ一覧）を閲覧できる。クライアントからは変更不可';

-- クライアントによる自己昇格を防止（SQL Editor / service_role では auth.uid() が null のため変更可）
create or replace function public.protect_is_administrator()
returns trigger
language plpgsql
as $$
begin
  if new.is_administrator is distinct from old.is_administrator
     and auth.uid() is not null then
    raise exception 'is_administrator はクライアントから変更できません';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_is_administrator on public.users;
create trigger trg_protect_is_administrator
  before update on public.users
  for each row
  execute function public.protect_is_administrator();

create or replace function public.is_administrator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select u.is_administrator
      from public.users u
      where u.id = auth.uid()
    ),
    false
  );
$$;

revoke all on function public.is_administrator() from public;
grant execute on function public.is_administrator() to authenticated;

create table if not exists public.example_content_reports (
  id uuid primary key default gen_random_uuid(),
  example_id uuid not null references public.examples (id) on delete cascade,
  example_title text not null,
  certification_id uuid references public.certifications (id) on delete set null,
  certification_name text not null default '',
  reporter_user_id uuid not null references public.users (id) on delete cascade,
  target text not null,
  message text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  constraint example_content_reports_target_check
    check (target in ('question', 'choices', 'explanation', 'other')),
  constraint example_content_reports_status_check
    check (status in ('open', 'resolved')),
  constraint example_content_reports_message_check
    check (char_length(trim(message)) > 0)
);

create index if not exists example_content_reports_created_at_idx
  on public.example_content_reports (created_at desc);

create index if not exists example_content_reports_status_idx
  on public.example_content_reports (status, created_at desc);

create index if not exists example_content_reports_example_id_idx
  on public.example_content_reports (example_id);

comment on table public.example_content_reports is
  '例題の問題文・選択肢・解説などの誤り連絡。メール通知は後続で接続予定';

alter table public.example_content_reports enable row level security;

drop policy if exists example_content_reports_insert_own on public.example_content_reports;
create policy example_content_reports_insert_own
  on public.example_content_reports for insert
  to authenticated
  with check (auth.uid() = reporter_user_id);

drop policy if exists example_content_reports_select_own_or_admin on public.example_content_reports;
create policy example_content_reports_select_own_or_admin
  on public.example_content_reports for select
  to authenticated
  using (
    auth.uid() = reporter_user_id
    or public.is_administrator()
  );

drop policy if exists example_content_reports_update_admin on public.example_content_reports;
create policy example_content_reports_update_admin
  on public.example_content_reports for update
  to authenticated
  using (public.is_administrator())
  with check (public.is_administrator());
