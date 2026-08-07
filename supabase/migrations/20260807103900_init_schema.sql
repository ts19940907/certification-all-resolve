-- CertResolve 初期スキーマ
-- 決定事項に基づく最小テーブル一式（認証ユーザー作成後に RLS が効く）

-- ---------------------------------------------------------------------------
-- 拡張
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- ユーザー（auth.users と 1:1。id は Auth の uid と同じ）
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  mail_address text not null,
  created_at timestamptz not null default now(),
  constraint users_mail_address_key unique (mail_address)
);

comment on table public.users is 'アプリ利用者。id は auth.users.id と同一';

-- ---------------------------------------------------------------------------
-- 資格マスタ（ユーザーごとに別レコード）
-- ---------------------------------------------------------------------------
create table if not exists public.certifications (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

comment on table public.certifications is '資格。ユーザーごと別行。所有は user_certifications で管理';

-- ---------------------------------------------------------------------------
-- ユーザー ↔ 資格（スペース状態）
-- ---------------------------------------------------------------------------
create table if not exists public.user_certifications (
  id uuid primary key default gen_random_uuid(),
  certification_id uuid not null references public.certifications (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  registered_date timestamptz not null default now(),
  is_archive boolean not null default false,
  constraint user_certifications_certification_id_key unique (certification_id),
  constraint user_certifications_user_cert_key unique (user_id, certification_id)
);

create index if not exists user_certifications_user_id_idx
  on public.user_certifications (user_id);

create index if not exists user_certifications_user_archive_idx
  on public.user_certifications (user_id, is_archive);

comment on table public.user_certifications is 'ユーザーの資格スペース。アーカイブ状態を持つ';

-- 同一ユーザー内で資格名はアーカイブ含め一意
create or replace function public.enforce_unique_cert_name_per_user()
returns trigger
language plpgsql
as $$
declare
  v_user_id uuid;
  v_name text;
  v_conflict int;
begin
  if tg_table_name = 'certifications' then
    v_name := new.name;
    select uc.user_id into v_user_id
    from public.user_certifications uc
    where uc.certification_id = new.id;

    if v_user_id is null then
      return new;
    end if;
  elsif tg_table_name = 'user_certifications' then
    v_user_id := new.user_id;
    select c.name into v_name
    from public.certifications c
    where c.id = new.certification_id;
  else
    return new;
  end if;

  select count(*) into v_conflict
  from public.user_certifications uc
  join public.certifications c on c.id = uc.certification_id
  where uc.user_id = v_user_id
    and c.name = v_name
    and c.id is distinct from (
      case
        when tg_table_name = 'certifications' then new.id
        else new.certification_id
      end
    );

  if v_conflict > 0 then
    raise exception '同じ名前の資格がすでにあります（アーカイブ含む）'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_certifications_unique_name on public.certifications;
create trigger trg_certifications_unique_name
  before insert or update of name
  on public.certifications
  for each row
  execute function public.enforce_unique_cert_name_per_user();

drop trigger if exists trg_user_certifications_unique_name on public.user_certifications;
create trigger trg_user_certifications_unique_name
  before insert or update of user_id, certification_id
  on public.user_certifications
  for each row
  execute function public.enforce_unique_cert_name_per_user();

-- ---------------------------------------------------------------------------
-- 例題
-- ---------------------------------------------------------------------------
create table if not exists public.examples (
  id uuid primary key default gen_random_uuid(),
  certification_id uuid not null references public.certifications (id) on delete cascade,
  title text not null,
  question text not null,
  answer text not null,
  explanation text not null,
  question_images text[] not null default '{}',
  explanation_images text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists examples_certification_id_idx
  on public.examples (certification_id);

comment on table public.examples is '例題。画像は Storage パス配列';

create or replace function public.set_examples_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_examples_updated_at on public.examples;
create trigger trg_examples_updated_at
  before update on public.examples
  for each row
  execute function public.set_examples_updated_at();

-- ---------------------------------------------------------------------------
-- 実施履歴
-- ---------------------------------------------------------------------------
create table if not exists public.histories (
  id uuid primary key default gen_random_uuid(),
  certification_id uuid not null references public.certifications (id) on delete cascade,
  kind text not null,
  title text not null,
  summary text not null,
  performed_at timestamptz not null default now(),
  detail jsonb
);

create index if not exists histories_certification_id_idx
  on public.histories (certification_id);

create index if not exists histories_performed_at_idx
  on public.histories (certification_id, performed_at desc);

comment on table public.histories is '実施履歴。一覧は title/summary、詳細で detail';
comment on column public.histories.kind is '例: example_run / example_single / keyword_review / exam など';

-- ---------------------------------------------------------------------------
-- Auth ユーザー作成時に public.users を自動作成
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, name, mail_address)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), 'user'),
    coalesce(new.email, '')
  )
  on conflict (id) do update
    set mail_address = excluded.mail_address;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS（認証後にクライアントから安全に触るための土台）
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.certifications enable row level security;
alter table public.user_certifications enable row level security;
alter table public.examples enable row level security;
alter table public.histories enable row level security;

-- users
drop policy if exists users_select_own on public.users;
create policy users_select_own
  on public.users for select
  using (auth.uid() = id);

drop policy if exists users_update_own on public.users;
create policy users_update_own
  on public.users for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- user_certifications
drop policy if exists user_certifications_select_own on public.user_certifications;
create policy user_certifications_select_own
  on public.user_certifications for select
  using (auth.uid() = user_id);

drop policy if exists user_certifications_insert_own on public.user_certifications;
create policy user_certifications_insert_own
  on public.user_certifications for insert
  with check (auth.uid() = user_id);

drop policy if exists user_certifications_update_own on public.user_certifications;
create policy user_certifications_update_own
  on public.user_certifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists user_certifications_delete_own on public.user_certifications;
create policy user_certifications_delete_own
  on public.user_certifications for delete
  using (auth.uid() = user_id);

-- certifications: 自分のスペースに紐づくものだけ
drop policy if exists certifications_select_own on public.certifications;
create policy certifications_select_own
  on public.certifications for select
  using (
    exists (
      select 1
      from public.user_certifications uc
      where uc.certification_id = certifications.id
        and uc.user_id = auth.uid()
    )
  );

drop policy if exists certifications_insert_authenticated on public.certifications;
create policy certifications_insert_authenticated
  on public.certifications for insert
  with check (auth.uid() is not null);

drop policy if exists certifications_update_own on public.certifications;
create policy certifications_update_own
  on public.certifications for update
  using (
    exists (
      select 1
      from public.user_certifications uc
      where uc.certification_id = certifications.id
        and uc.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.user_certifications uc
      where uc.certification_id = certifications.id
        and uc.user_id = auth.uid()
    )
  );

drop policy if exists certifications_delete_own on public.certifications;
create policy certifications_delete_own
  on public.certifications for delete
  using (
    exists (
      select 1
      from public.user_certifications uc
      where uc.certification_id = certifications.id
        and uc.user_id = auth.uid()
    )
  );

-- examples
drop policy if exists examples_select_own on public.examples;
create policy examples_select_own
  on public.examples for select
  using (
    exists (
      select 1
      from public.user_certifications uc
      where uc.certification_id = examples.certification_id
        and uc.user_id = auth.uid()
    )
  );

drop policy if exists examples_insert_own on public.examples;
create policy examples_insert_own
  on public.examples for insert
  with check (
    exists (
      select 1
      from public.user_certifications uc
      where uc.certification_id = examples.certification_id
        and uc.user_id = auth.uid()
    )
  );

drop policy if exists examples_update_own on public.examples;
create policy examples_update_own
  on public.examples for update
  using (
    exists (
      select 1
      from public.user_certifications uc
      where uc.certification_id = examples.certification_id
        and uc.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.user_certifications uc
      where uc.certification_id = examples.certification_id
        and uc.user_id = auth.uid()
    )
  );

drop policy if exists examples_delete_own on public.examples;
create policy examples_delete_own
  on public.examples for delete
  using (
    exists (
      select 1
      from public.user_certifications uc
      where uc.certification_id = examples.certification_id
        and uc.user_id = auth.uid()
    )
  );

-- histories
drop policy if exists histories_select_own on public.histories;
create policy histories_select_own
  on public.histories for select
  using (
    exists (
      select 1
      from public.user_certifications uc
      where uc.certification_id = histories.certification_id
        and uc.user_id = auth.uid()
    )
  );

drop policy if exists histories_insert_own on public.histories;
create policy histories_insert_own
  on public.histories for insert
  with check (
    exists (
      select 1
      from public.user_certifications uc
      where uc.certification_id = histories.certification_id
        and uc.user_id = auth.uid()
    )
  );

drop policy if exists histories_update_own on public.histories;
create policy histories_update_own
  on public.histories for update
  using (
    exists (
      select 1
      from public.user_certifications uc
      where uc.certification_id = histories.certification_id
        and uc.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.user_certifications uc
      where uc.certification_id = histories.certification_id
        and uc.user_id = auth.uid()
    )
  );

drop policy if exists histories_delete_own on public.histories;
create policy histories_delete_own
  on public.histories for delete
  using (
    exists (
      select 1
      from public.user_certifications uc
      where uc.certification_id = histories.certification_id
        and uc.user_id = auth.uid()
    )
  );
