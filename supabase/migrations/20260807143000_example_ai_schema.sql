-- 例題AI生成用: 資格の出題形式ビット・選択肢範囲、select_answer

-- ---------------------------------------------------------------------------
-- certifications: 出題形式・プロンプト用の選択肢/正解数レンジ
-- question_format ビット: 1=単一選択, 2=複数選択, 4=記述
-- ---------------------------------------------------------------------------
alter table public.certifications
  add column if not exists question_format integer not null default 0;

alter table public.certifications
  add column if not exists choice_min integer;

alter table public.certifications
  add column if not exists choice_max integer;

alter table public.certifications
  add column if not exists answer_max integer;

comment on column public.certifications.question_format is
  '出題形式ビットフラグ。1=単一選択, 2=複数選択, 4=記述。ORで複数可';
comment on column public.certifications.choice_min is
  '選択肢数の下限（生成プロンプト用。NULL可）';
comment on column public.certifications.choice_max is
  '選択肢数の上限（生成プロンプト用。NULL可）';
comment on column public.certifications.answer_max is
  '正解数の上限（生成プロンプト用。NULL可）';

-- ---------------------------------------------------------------------------
-- select_answer: 選択式の選択肢と正誤理由
-- ---------------------------------------------------------------------------
create table if not exists public.select_answer (
  id uuid primary key default gen_random_uuid(),
  example_id uuid not null references public.examples (id) on delete cascade,
  value text not null,
  is_answer boolean not null default false,
  reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists select_answer_example_id_idx
  on public.select_answer (example_id);

comment on table public.select_answer is
  '選択式例題の選択肢。正解は is_answer。各選択肢の正誤理由は reason';

create or replace function public.set_select_answer_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_select_answer_updated_at on public.select_answer;
create trigger trg_select_answer_updated_at
  before update on public.select_answer
  for each row
  execute function public.set_select_answer_updated_at();

alter table public.select_answer enable row level security;

drop policy if exists select_answer_select_own on public.select_answer;
create policy select_answer_select_own
  on public.select_answer for select
  using (
    exists (
      select 1
      from public.examples e
      join public.user_certifications uc on uc.certification_id = e.certification_id
      where e.id = select_answer.example_id
        and uc.user_id = auth.uid()
    )
  );

drop policy if exists select_answer_insert_own on public.select_answer;
create policy select_answer_insert_own
  on public.select_answer for insert
  with check (
    exists (
      select 1
      from public.examples e
      join public.user_certifications uc on uc.certification_id = e.certification_id
      where e.id = select_answer.example_id
        and uc.user_id = auth.uid()
    )
  );

drop policy if exists select_answer_update_own on public.select_answer;
create policy select_answer_update_own
  on public.select_answer for update
  using (
    exists (
      select 1
      from public.examples e
      join public.user_certifications uc on uc.certification_id = e.certification_id
      where e.id = select_answer.example_id
        and uc.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.examples e
      join public.user_certifications uc on uc.certification_id = e.certification_id
      where e.id = select_answer.example_id
        and uc.user_id = auth.uid()
    )
  );

drop policy if exists select_answer_delete_own on public.select_answer;
create policy select_answer_delete_own
  on public.select_answer for delete
  using (
    exists (
      select 1
      from public.examples e
      join public.user_certifications uc on uc.certification_id = e.certification_id
      where e.id = select_answer.example_id
        and uc.user_id = auth.uid()
    )
  );
