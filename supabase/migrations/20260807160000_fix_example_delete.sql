-- 例題削除時の trigger 不整合対策 + 安全な物理削除 RPC
-- エラー例: record "new" has no field "certification_id"

-- 1) 資格名一意制約: テーブルごとに NEW の参照を分離（無いカラムへ触れない）
create or replace function public.enforce_unique_cert_name_per_user()
returns trigger
language plpgsql
as $$
declare
  v_user_id uuid;
  v_name text;
  v_conflict int;
  v_exclude_cert_id uuid;
begin
  if tg_table_name = 'certifications' then
    v_name := new.name;
    v_exclude_cert_id := new.id;
    select uc.user_id into v_user_id
    from public.user_certifications uc
    where uc.certification_id = new.id;

    if v_user_id is null then
      return new;
    end if;
  elsif tg_table_name = 'user_certifications' then
    v_user_id := new.user_id;
    v_exclude_cert_id := new.certification_id;
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
    and c.id is distinct from v_exclude_cert_id;

  if v_conflict > 0 then
    raise exception '同じ名前の資格がすでにあります（アーカイブ含む）'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

-- 2) select_answer の updated_at は UPDATE のみ（誤定義の掃除）
drop trigger if exists trg_select_answer_updated_at on public.select_answer;
drop trigger if exists trg_select_answer_unique_name on public.select_answer;

create or replace function public.set_select_answer_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_select_answer_updated_at
  before update on public.select_answer
  for each row
  execute function public.set_select_answer_updated_at();

-- 3) examples の updated_at も UPDATE のみを明示
drop trigger if exists trg_examples_updated_at on public.examples;
create trigger trg_examples_updated_at
  before update on public.examples
  for each row
  execute function public.set_examples_updated_at();

-- 4) 所有確認付きの物理削除 RPC（choices を先に消してから examples を消す）
create or replace function public.delete_example(p_example_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'ログインが必要です';
  end if;

  if not exists (
    select 1
    from public.examples e
    join public.user_certifications uc
      on uc.certification_id = e.certification_id
    where e.id = p_example_id
      and uc.user_id = v_uid
  ) then
    raise exception '例題を削除する権限がありません';
  end if;

  delete from public.select_answer
  where example_id = p_example_id;

  delete from public.examples
  where id = p_example_id;
end;
$$;

revoke all on function public.delete_example(uuid) from public;
grant execute on function public.delete_example(uuid) to authenticated;
