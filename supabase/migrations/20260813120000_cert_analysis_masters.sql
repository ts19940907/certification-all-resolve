-- 資格ごとのカテゴリ／キーワードマスタ + 例題カテゴリ + マスタ変更問い合わせ

create table if not exists public.certification_categories (
  id uuid primary key default gen_random_uuid(),
  certification_id uuid not null references public.certifications (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint certification_categories_name_check
    check (char_length(trim(name)) > 0),
  constraint certification_categories_unique_name
    unique (certification_id, name)
);

create index if not exists certification_categories_cert_idx
  on public.certification_categories (certification_id, sort_order);

comment on table public.certification_categories is
  '資格ごとの分析用カテゴリマスタ。資格追加時に AI が自動生成';

create table if not exists public.certification_keywords (
  id uuid primary key default gen_random_uuid(),
  certification_id uuid not null references public.certifications (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint certification_keywords_name_check
    check (char_length(trim(name)) > 0),
  constraint certification_keywords_unique_name
    unique (certification_id, name)
);

create index if not exists certification_keywords_cert_idx
  on public.certification_keywords (certification_id, sort_order);

comment on table public.certification_keywords is
  '資格ごとのキーワードマスタ。説明できた進捗の分母になる';

alter table public.examples
  add column if not exists category_id uuid
    references public.certification_categories (id) on delete set null;

create index if not exists examples_category_id_idx
  on public.examples (category_id);

comment on column public.examples.category_id is
  '例題が属するカテゴリ（マスタ1件）。分析レーダーの軸に使う';

-- マスタ変更問い合わせのため example_id を任意に
alter table public.example_content_reports
  alter column example_id drop not null;

alter table public.example_content_reports
  drop constraint if exists example_content_reports_target_check;

alter table public.example_content_reports
  add constraint example_content_reports_target_check
  check (target in (
    'question',
    'choices',
    'explanation',
    'other',
    'category_master',
    'keyword_master'
  ));

alter table public.example_content_reports
  drop constraint if exists example_content_reports_example_required;

alter table public.example_content_reports
  add constraint example_content_reports_example_required
  check (
    (
      target in ('category_master', 'keyword_master')
      and example_id is null
    )
    or (
      target in ('question', 'choices', 'explanation', 'other')
      and example_id is not null
    )
  );

create or replace function public.user_owns_certification(p_certification_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_certifications uc
    where uc.certification_id = p_certification_id
      and uc.user_id = auth.uid()
  );
$$;

revoke all on function public.user_owns_certification(uuid) from public;
grant execute on function public.user_owns_certification(uuid) to authenticated;

alter table public.certification_categories enable row level security;
alter table public.certification_keywords enable row level security;

drop policy if exists certification_categories_select on public.certification_categories;
create policy certification_categories_select
  on public.certification_categories for select
  to authenticated
  using (public.user_owns_certification(certification_id));

drop policy if exists certification_categories_insert on public.certification_categories;
create policy certification_categories_insert
  on public.certification_categories for insert
  to authenticated
  with check (public.user_owns_certification(certification_id));

drop policy if exists certification_categories_update on public.certification_categories;
create policy certification_categories_update
  on public.certification_categories for update
  to authenticated
  using (public.user_owns_certification(certification_id))
  with check (public.user_owns_certification(certification_id));

drop policy if exists certification_categories_delete on public.certification_categories;
create policy certification_categories_delete
  on public.certification_categories for delete
  to authenticated
  using (public.user_owns_certification(certification_id));

drop policy if exists certification_keywords_select on public.certification_keywords;
create policy certification_keywords_select
  on public.certification_keywords for select
  to authenticated
  using (public.user_owns_certification(certification_id));

drop policy if exists certification_keywords_insert on public.certification_keywords;
create policy certification_keywords_insert
  on public.certification_keywords for insert
  to authenticated
  with check (public.user_owns_certification(certification_id));

drop policy if exists certification_keywords_update on public.certification_keywords;
create policy certification_keywords_update
  on public.certification_keywords for update
  to authenticated
  using (public.user_owns_certification(certification_id))
  with check (public.user_owns_certification(certification_id));

drop policy if exists certification_keywords_delete on public.certification_keywords;
create policy certification_keywords_delete
  on public.certification_keywords for delete
  to authenticated
  using (public.user_owns_certification(certification_id));
