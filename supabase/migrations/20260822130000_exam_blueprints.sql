-- 試験問題バンクの資格ごとブループリント
-- - certifications.exam_question_count: 本番の出題数（バンク目標は ×2）
-- - exam_blueprints / exam_blueprint_domains: ドメイン比率・複数選択目安
-- - examples.domain の SAP 固定 CHECK を撤廃

-- ---------------------------------------------------------------------------
-- 1) 本番出題数
-- ---------------------------------------------------------------------------
alter table public.certifications
  add column if not exists exam_question_count integer;

comment on column public.certifications.exam_question_count is
  '本番試験の出題数。試験問題バンクの目標件数は exam_question_count × 2';

alter table public.certifications
  drop constraint if exists certifications_exam_question_count_check;

alter table public.certifications
  add constraint certifications_exam_question_count_check
  check (
    exam_question_count is null
    or exam_question_count > 0
  );

-- ---------------------------------------------------------------------------
-- 2) ブループリント（資格 1 行）
-- ---------------------------------------------------------------------------
create table if not exists public.exam_blueprints (
  certification_id uuid primary key
    references public.certifications (id) on delete cascade,
  multi_min_ratio numeric(5, 4),
  multi_max_ratio numeric(5, 4),
  multi_target_ratio numeric(5, 4),
  prompt_exam_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exam_blueprints_multi_ratio_check check (
    (
      multi_min_ratio is null
      and multi_max_ratio is null
      and multi_target_ratio is null
    )
    or (
      multi_min_ratio is not null
      and multi_max_ratio is not null
      and multi_target_ratio is not null
      and multi_min_ratio >= 0
      and multi_max_ratio <= 1
      and multi_min_ratio <= multi_target_ratio
      and multi_target_ratio <= multi_max_ratio
    )
  )
);

comment on table public.exam_blueprints is
  '資格ごとの試験問題バンク設定（解答形式比率・生成ラベル）';
comment on column public.exam_blueprints.prompt_exam_label is
  '生成プロンプトで使う試験の呼び方。未設定時は certifications.name';

-- ---------------------------------------------------------------------------
-- 3) ドメイン行
-- ---------------------------------------------------------------------------
create table if not exists public.exam_blueprint_domains (
  id uuid primary key default gen_random_uuid(),
  certification_id uuid not null
    references public.certifications (id) on delete cascade,
  domain_key text not null,
  label text not null,
  category_name text not null,
  weight_percent numeric(6, 2) not null default 0,
  target_count integer not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint exam_blueprint_domains_cert_key unique (certification_id, domain_key),
  constraint exam_blueprint_domains_target_check check (target_count > 0),
  constraint exam_blueprint_domains_key_check check (length(trim(domain_key)) > 0)
);

create index if not exists exam_blueprint_domains_cert_idx
  on public.exam_blueprint_domains (certification_id, sort_order);

comment on table public.exam_blueprint_domains is
  '試験問題バンクのドメイン別目標件数・表示名';

-- ---------------------------------------------------------------------------
-- 4) examples.domain の SAP 固定 CHECK を外す
-- ---------------------------------------------------------------------------
alter table public.examples
  drop constraint if exists examples_domain_check;

comment on column public.examples.domain is
  '試験ドメインキー（exam_blueprint_domains.domain_key）。資格ごとに異なる';

-- ---------------------------------------------------------------------------
-- 5) RLS（認証ユーザーは紐づく資格のブループリントを読める）
-- ---------------------------------------------------------------------------
alter table public.exam_blueprints enable row level security;
alter table public.exam_blueprint_domains enable row level security;

drop policy if exists exam_blueprints_select_own on public.exam_blueprints;
create policy exam_blueprints_select_own
  on public.exam_blueprints
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.user_certifications uc
      where uc.certification_id = exam_blueprints.certification_id
        and uc.user_id = auth.uid()
    )
  );

drop policy if exists exam_blueprint_domains_select_own on public.exam_blueprint_domains;
create policy exam_blueprint_domains_select_own
  on public.exam_blueprint_domains
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.user_certifications uc
      where uc.certification_id = exam_blueprint_domains.certification_id
        and uc.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 6) SAP-C02 シード（既存マスタがあれば投入。出題数は後指示でも可だが SAP は 75 で入れる）
-- ---------------------------------------------------------------------------
do $$
declare
  v_cert_id uuid;
begin
  select c.id into v_cert_id
  from public.certifications c
  where c.exam_code = 'SAP-C02'
     or c.name ilike '%Solutions Architect%Professional%'
     or (
       c.name like '%ソリューションアーキテクト%'
       and c.name like '%プロフェッショナル%'
     )
  order by c.created_at asc
  limit 1;

  if v_cert_id is null then
    return;
  end if;

  update public.certifications
  set
    exam_code = coalesce(exam_code, 'SAP-C02'),
    exam_question_count = coalesce(exam_question_count, 75)
  where id = v_cert_id;

  insert into public.exam_blueprints (
    certification_id,
    multi_min_ratio,
    multi_max_ratio,
    multi_target_ratio,
    prompt_exam_label
  )
  values (
    v_cert_id,
    0.20,
    0.30,
    0.25,
    'AWS Certified Solutions Architect - Professional (SAP-C02)'
  )
  on conflict (certification_id) do update
  set
    multi_min_ratio = excluded.multi_min_ratio,
    multi_max_ratio = excluded.multi_max_ratio,
    multi_target_ratio = excluded.multi_target_ratio,
    prompt_exam_label = excluded.prompt_exam_label,
    updated_at = now();

  insert into public.exam_blueprint_domains (
    certification_id,
    domain_key,
    label,
    category_name,
    weight_percent,
    target_count,
    sort_order
  )
  values
    (
      v_cert_id,
      'organizational_complexity',
      'Design Solutions for Organizational Complexity',
      '組織の複雑さへの設計',
      26,
      39,
      1
    ),
    (
      v_cert_id,
      'new_solutions',
      'Design for New Solutions',
      '新規ソリューションの設計',
      29,
      44,
      2
    ),
    (
      v_cert_id,
      'continuous_improvement',
      'Continuous Improvement for Existing Solutions',
      '既存ソリューションの継続的改善',
      25,
      37,
      3
    ),
    (
      v_cert_id,
      'migration_modernization',
      'Accelerate Workload Migration and Modernization',
      '移行とモダナイゼーション',
      20,
      30,
      4
    )
  on conflict (certification_id, domain_key) do update
  set
    label = excluded.label,
    category_name = excluded.category_name,
    weight_percent = excluded.weight_percent,
    target_count = excluded.target_count,
    sort_order = excluded.sort_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) create_certification: 出題数を受け取る（新規マスタ時は必須）
-- ---------------------------------------------------------------------------
drop function if exists public.create_certification(text, integer, integer, integer, integer);

create or replace function public.create_certification(
  p_name text,
  p_question_format integer default 0,
  p_choice_min integer default null,
  p_choice_max integer default null,
  p_answer_max integer default null,
  p_exam_question_count integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := trim(p_name);
  v_format integer := coalesce(p_question_format, 0);
  v_cert_id uuid;
  v_uc_id uuid;
  v_existing_id uuid;
  v_existing_format integer;
  v_existing_count integer;
  v_exam_count integer := p_exam_question_count;
begin
  if v_uid is null then
    raise exception 'ログインが必要です';
  end if;

  if v_name is null or v_name = '' then
    raise exception '資格名を入力してください';
  end if;

  v_format := v_format & 7;
  if v_format = 0 then
    raise exception '対応する出題形式が存在しないため、作成できません';
  end if;

  perform public.ensure_current_user();

  if exists (
    select 1
    from public.user_certifications uc
    join public.certifications c on c.id = uc.certification_id
    where uc.user_id = v_uid
      and c.name = v_name
  ) then
    raise exception '同じ名前の資格がすでにあります（アーカイブ含む）'
      using errcode = '23505';
  end if;

  select c.id, c.question_format, c.exam_question_count
    into v_existing_id, v_existing_format, v_existing_count
  from public.certifications c
  where c.name = v_name
  limit 1;

  if v_existing_id is not null then
    v_cert_id := v_existing_id;
    v_format := coalesce(v_existing_format, v_format);
    v_exam_count := v_existing_count;
  else
    if v_exam_count is null or v_exam_count <= 0 then
      raise exception '本番試験の出題数を入力してください';
    end if;

    insert into public.certifications (
      name,
      question_format,
      choice_min,
      choice_max,
      answer_max,
      exam_question_count
    )
    values (
      v_name,
      v_format,
      p_choice_min,
      p_choice_max,
      p_answer_max,
      v_exam_count
    )
    returning id into v_cert_id;
  end if;

  insert into public.user_certifications (certification_id, user_id, is_archive)
  values (v_cert_id, v_uid, false)
  returning id into v_uc_id;

  return jsonb_build_object(
    'id', v_cert_id,
    'userCertificationId', v_uc_id,
    'name', v_name,
    'isArchive', false,
    'questionFormat', v_format,
    'choiceMin', p_choice_min,
    'choiceMax', p_choice_max,
    'answerMax', p_answer_max,
    'examQuestionCount', v_exam_count
  );
end;
$$;

revoke all on function public.create_certification(text, integer, integer, integer, integer, integer) from public;
grant execute on function public.create_certification(text, integer, integer, integer, integer, integer) to authenticated;
