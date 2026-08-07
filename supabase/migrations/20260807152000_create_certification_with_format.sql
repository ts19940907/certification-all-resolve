-- 資格作成RPCを拡張: 正式名称に加え出題形式・選択肢レンジを保存

drop function if exists public.create_certification(text);

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
begin
  if v_uid is null then
    raise exception 'ログインが必要です';
  end if;

  if v_name is null or v_name = '' then
    raise exception '資格名を入力してください';
  end if;

  -- 許可ビットのみ: 1単一 / 2複数 / 4記述
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
