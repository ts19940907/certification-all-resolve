-- 許可メール（バックエンド判定）
-- Auth の新規ユーザー作成時に、許可リスト外なら拒否する

create table if not exists public.allowed_emails (
  email text primary key,
  created_at timestamptz not null default now()
);

comment on table public.allowed_emails is 'サインアップを許可するメールアドレス一覧';

alter table public.allowed_emails enable row level security;

-- クライアントからは読めない（判定は security definer の関数経由）
drop policy if exists allowed_emails_no_direct_access on public.allowed_emails;
-- RLS有効・ポリシーなし = 直接 SELECT 不可（service role / security definer のみ）

create or replace function public.is_email_allowed(check_email text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.allowed_emails
    where lower(email) = lower(trim(check_email))
  );
$$;

revoke all on function public.is_email_allowed(text) from public;
grant execute on function public.is_email_allowed(text) to anon, authenticated;

comment on function public.is_email_allowed(text) is '許可メールかどうかを返す。中身の一覧は公開しない';

create or replace function public.enforce_email_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null or not public.is_email_allowed(new.email) then
    raise exception 'このメールアドレスは登録を許可されていません'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_email_allowlist on auth.users;
create trigger trg_enforce_email_allowlist
  before insert on auth.users
  for each row
  execute function public.enforce_email_allowlist();
