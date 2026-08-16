-- certifications を一意な資格マスタへ、user_certifications を中間テーブルへ再定義
-- examples / histories に user_id を追加し、共有バンク取り込み用の中間テーブルを追加

-- ---------------------------------------------------------------------------
-- 1) examples: user_id / domain
-- ---------------------------------------------------------------------------
alter table public.examples
  add column if not exists user_id uuid references public.users (id) on delete cascade;

alter table public.examples
  add column if not exists domain text;

comment on column public.examples.user_id is
  '例題の所有者。NULL は共有バンク問題';
comment on column public.examples.domain is
  '試験ドメイン（例: organizational_complexity）。共有バンクの出題比率用';

alter table public.examples
  drop constraint if exists examples_domain_check;

alter table public.examples
  add constraint examples_domain_check
  check (
    domain is null
    or domain in (
      'organizational_complexity',
      'new_solutions',
      'continuous_improvement',
      'migration_modernization'
    )
  );

create index if not exists examples_user_id_idx
  on public.examples (user_id);

create index if not exists examples_cert_user_idx
  on public.examples (certification_id, user_id);

create index if not exists examples_cert_domain_idx
  on public.examples (certification_id, domain)
  where domain is not null;

-- 既存例題: 当時その資格を持っていたユーザーへ帰属（当時は qualification 1:1）
update public.examples e
set user_id = uc.user_id
from public.user_certifications uc
where uc.certification_id = e.certification_id
  and e.user_id is null;

-- ---------------------------------------------------------------------------
-- 2) histories: user_id（共有マスタ化後の混在防止）
-- ---------------------------------------------------------------------------
alter table public.histories
  add column if not exists user_id uuid references public.users (id) on delete cascade;

comment on column public.histories.user_id is
  '履歴の所有者';

update public.histories h
set user_id = uc.user_id
from public.user_certifications uc
where uc.certification_id = h.certification_id
  and h.user_id is null;

-- 所有者不明の履歴は残すと共有後に漏れるため削除
delete from public.histories
where user_id is null;

alter table public.histories
  alter column user_id set not null;

create index if not exists histories_user_id_idx
  on public.histories (user_id);

create index if not exists histories_user_cert_performed_idx
  on public.histories (user_id, certification_id, performed_at desc);

-- ---------------------------------------------------------------------------
-- 3) 同名資格を1マスタへ統合
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  keeper uuid;
  dup uuid;
  old_cat uuid;
  new_cat uuid;
  cat_name text;
  cat_rec record;
begin
  for r in
    select trim(name) as n
    from public.certifications
    group by trim(name)
    having count(*) > 1
  loop
    select c.id into keeper
    from public.certifications c
    where trim(c.name) = r.n
    order by c.created_at asc, c.id asc
    limit 1;

    for dup in
      select c.id
      from public.certifications c
      where trim(c.name) = r.n
        and c.id <> keeper
    loop
      -- user_certifications 付け替え（同一ユーザー重複は旧行を削除）
      delete from public.user_certifications uc
      where uc.certification_id = dup
        and exists (
          select 1
          from public.user_certifications x
          where x.user_id = uc.user_id
            and x.certification_id = keeper
        );

      update public.user_certifications
      set certification_id = keeper
      where certification_id = dup;

      -- カテゴリ統合
      for cat_rec in
        select cc.id, cc.name
        from public.certification_categories cc
        where cc.certification_id = dup
      loop
        old_cat := cat_rec.id;
        cat_name := cat_rec.name;

        select cc.id into new_cat
        from public.certification_categories cc
        where cc.certification_id = keeper
          and cc.name = cat_name
        limit 1;

        if new_cat is null then
          update public.certification_categories
          set certification_id = keeper
          where id = old_cat;
        else
          update public.examples
          set category_id = new_cat
          where category_id = old_cat;
          delete from public.certification_categories
          where id = old_cat;
        end if;
      end loop;

      -- キーワード統合
      update public.certification_keywords k
      set certification_id = keeper
      where k.certification_id = dup
        and not exists (
          select 1
          from public.certification_keywords x
          where x.certification_id = keeper
            and x.name = k.name
        );

      delete from public.certification_keywords
      where certification_id = dup;

      update public.examples set certification_id = keeper where certification_id = dup;
      update public.histories set certification_id = keeper where certification_id = dup;
      update public.srs_cards set certification_id = keeper where certification_id = dup;
      update public.user_notifications set certification_id = keeper where certification_id = dup;
      update public.example_content_reports set certification_id = keeper where certification_id = dup;

      delete from public.certifications where id = dup;
    end loop;

    -- 表示名を trim 済みに揃える
    update public.certifications
    set name = r.n
    where id = keeper
      and name is distinct from r.n;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) certifications = マスタ制約
-- ---------------------------------------------------------------------------
drop trigger if exists trg_certifications_unique_name on public.certifications;
drop trigger if exists trg_user_certifications_unique_name on public.user_certifications;

alter table public.user_certifications
  drop constraint if exists user_certifications_certification_id_key;

-- グローバル一意な資格名
create unique index if not exists certifications_name_unique
  on public.certifications (name);

alter table public.certifications
  add column if not exists exam_code text;

comment on column public.certifications.exam_code is
  '試験コード（例: SAP-C02）。任意だが一意';

create unique index if not exists certifications_exam_code_unique
  on public.certifications (exam_code)
  where exam_code is not null;

comment on table public.certifications is
  '資格マスタ。正式名称ごとに1行。共有バンクの親';
comment on table public.user_certifications is
  'ユーザー↔資格マスタ。学習中／アーカイブ状態を持つ中間テーブル';

-- マスタ名のグローバル一意（トリガーでも保険）
create or replace function public.enforce_unique_cert_master_name()
returns trigger
language plpgsql
as $$
begin
  new.name := trim(new.name);
  if new.name is null or new.name = '' then
    raise exception '資格名を入力してください';
  end if;
  if exists (
    select 1
    from public.certifications c
    where c.name = new.name
      and c.id is distinct from new.id
  ) then
    raise exception '同じ名前の資格マスタがすでにあります'
      using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger trg_certifications_unique_name
  before insert or update of name
  on public.certifications
  for each row
  execute function public.enforce_unique_cert_master_name();

-- ユーザーが同じマスタを二重登録しない（既存 unique を維持）
-- user_certifications_user_cert_key はそのまま

-- ---------------------------------------------------------------------------
-- 5) 共有バンク取り込み中間テーブル
-- ---------------------------------------------------------------------------
create table if not exists public.user_example_library (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  example_id uuid not null references public.examples (id) on delete cascade,
  imported_at timestamptz not null default now(),
  constraint user_example_library_user_example_key unique (user_id, example_id)
);

create index if not exists user_example_library_user_id_idx
  on public.user_example_library (user_id);

create index if not exists user_example_library_example_id_idx
  on public.user_example_library (example_id);

comment on table public.user_example_library is
  '共有バンク例題をユーザーの例題リストへ取り込んだ記録。行削除でリストから外せる（再取り込み可）';

create or replace function public.enforce_library_bank_example()
returns trigger
language plpgsql
as $$
declare
  v_owner uuid;
begin
  select e.user_id into v_owner
  from public.examples e
  where e.id = new.example_id;

  if not found then
    raise exception '例題が存在しません';
  end if;

  if v_owner is not null then
    raise exception '共有バンクの例題のみ取り込めます';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_user_example_library_bank_only on public.user_example_library;
create trigger trg_user_example_library_bank_only
  before insert or update of example_id
  on public.user_example_library
  for each row
  execute function public.enforce_library_bank_example();

alter table public.user_example_library enable row level security;

drop policy if exists user_example_library_select_own on public.user_example_library;
create policy user_example_library_select_own
  on public.user_example_library for select
  using (auth.uid() = user_id);

drop policy if exists user_example_library_insert_own on public.user_example_library;
create policy user_example_library_insert_own
  on public.user_example_library for insert
  with check (auth.uid() = user_id);

drop policy if exists user_example_library_delete_own on public.user_example_library;
create policy user_example_library_delete_own
  on public.user_example_library for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 6) RLS: examples / histories / certifications 削除抑制
-- ---------------------------------------------------------------------------

-- examples: 自分の例題 / 紐づく資格の共有バンク / 取り込んだ例題
drop policy if exists examples_select_own on public.examples;
create policy examples_select_own
  on public.examples for select
  using (
    examples.user_id = auth.uid()
    or (
      examples.user_id is null
      and exists (
        select 1
        from public.user_certifications uc
        where uc.certification_id = examples.certification_id
          and uc.user_id = auth.uid()
      )
    )
    or exists (
      select 1
      from public.user_example_library lib
      where lib.example_id = examples.id
        and lib.user_id = auth.uid()
    )
  );

drop policy if exists examples_insert_own on public.examples;
create policy examples_insert_own
  on public.examples for insert
  with check (
    examples.user_id = auth.uid()
    and exists (
      select 1
      from public.user_certifications uc
      where uc.certification_id = examples.certification_id
        and uc.user_id = auth.uid()
    )
  );

drop policy if exists examples_update_own on public.examples;
create policy examples_update_own
  on public.examples for update
  using (examples.user_id = auth.uid())
  with check (examples.user_id = auth.uid());

drop policy if exists examples_delete_own on public.examples;
create policy examples_delete_own
  on public.examples for delete
  using (examples.user_id = auth.uid());

-- histories: 本人のみ
drop policy if exists histories_select_own on public.histories;
create policy histories_select_own
  on public.histories for select
  using (histories.user_id = auth.uid());

drop policy if exists histories_insert_own on public.histories;
create policy histories_insert_own
  on public.histories for insert
  with check (
    histories.user_id = auth.uid()
    and exists (
      select 1
      from public.user_certifications uc
      where uc.certification_id = histories.certification_id
        and uc.user_id = auth.uid()
    )
  );

drop policy if exists histories_update_own on public.histories;
create policy histories_update_own
  on public.histories for update
  using (histories.user_id = auth.uid())
  with check (histories.user_id = auth.uid());

drop policy if exists histories_delete_own on public.histories;
create policy histories_delete_own
  on public.histories for delete
  using (histories.user_id = auth.uid());

-- マスタ削除: 自分だけが紐づいているときのみ（他ユーザー共有中は不可）
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
    and not exists (
      select 1
      from public.user_certifications uc
      where uc.certification_id = certifications.id
        and uc.user_id <> auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 7) RPC: create_certification（既存マスタへ参加 or 新規）
-- ---------------------------------------------------------------------------
create or replace function public.create_certification(
  p_name text,
  p_question_format integer default 0,
  p_choice_min integer default null,
  p_choice_max integer default null,
  p_answer_max integer default null
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

  select c.id, c.question_format
    into v_existing_id, v_existing_format
  from public.certifications c
  where c.name = v_name
  limit 1;

  if v_existing_id is not null then
    v_cert_id := v_existing_id;
    v_format := coalesce(v_existing_format, v_format);
  else
    insert into public.certifications (
      name,
      question_format,
      choice_min,
      choice_max,
      answer_max
    )
    values (
      v_name,
      v_format,
      p_choice_min,
      p_choice_max,
      p_answer_max
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
    'answerMax', p_answer_max
  );
end;
$$;

revoke all on function public.create_certification(text, integer, integer, integer, integer) from public;
grant execute on function public.create_certification(text, integer, integer, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 8) RPC: delete_example（自分の例題のみ物理削除。共有は取り込み解除）
-- ---------------------------------------------------------------------------
create or replace function public.delete_example(p_example_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_removed int;
begin
  if v_uid is null then
    raise exception 'ログインが必要です';
  end if;

  select e.user_id into v_owner
  from public.examples e
  where e.id = p_example_id;

  if not found then
    raise exception '例題が見つかりません';
  end if;

  if v_owner is null then
    delete from public.user_example_library
    where user_id = v_uid
      and example_id = p_example_id;
    get diagnostics v_removed = row_count;
    if v_removed = 0 then
      raise exception '例題を削除する権限がありません';
    end if;
    return;
  end if;

  if v_owner is distinct from v_uid then
    raise exception '例題を削除する権限がありません';
  end if;

  delete from public.select_answer
  where example_id = p_example_id;

  delete from public.examples
  where id = p_example_id
    and user_id = v_uid;
end;
$$;

revoke all on function public.delete_example(uuid) from public;
grant execute on function public.delete_example(uuid) to authenticated;
