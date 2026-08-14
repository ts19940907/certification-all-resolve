-- ユーザー設定（試験後の共有バンク取り込み確認など）

alter table public.users
  add column if not exists prompt_bank_import_after_exam boolean not null default true;

comment on column public.users.prompt_bank_import_after_exam is
  '未取り込みの共有バンク問題があるとき、模擬試験終了後に取り込み確認ダイアログを出すか';

-- Auth のメール変更確定後に public.users.mail_address を同期
create or replace function public.sync_user_mail_address()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email and new.email is not null then
    update public.users
    set mail_address = new.email
    where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  execute function public.sync_user_mail_address();
