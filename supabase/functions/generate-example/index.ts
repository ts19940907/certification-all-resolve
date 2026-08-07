import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const QUESTION_FORMAT = {
  SINGLE_CHOICE: 1,
  MULTIPLE_CHOICE: 2,
  DESCRIPTIVE: 4,
} as const;

type QuestionFormatBit =
  | typeof QUESTION_FORMAT.SINGLE_CHOICE
  | typeof QUESTION_FORMAT.MULTIPLE_CHOICE
  | typeof QUESTION_FORMAT.DESCRIPTIVE;

type ChoiceDraft = {
  value: string;
  is_answer: boolean;
  reason: string;
};

type ExampleDraft = {
  title: string;
  question: string;
  answer: string;
  explanation: string;
  choices: ChoiceDraft[];
};

type CertRow = {
  id: string;
  name: string;
  question_format: number;
  choice_min: number | null;
  choice_max: number | null;
  answer_max: number | null;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function enabledFormats(flags: number): QuestionFormatBit[] {
  const list: QuestionFormatBit[] = [];
  if (flags & QUESTION_FORMAT.SINGLE_CHOICE) {
    list.push(QUESTION_FORMAT.SINGLE_CHOICE);
  }
  if (flags & QUESTION_FORMAT.MULTIPLE_CHOICE) {
    list.push(QUESTION_FORMAT.MULTIPLE_CHOICE);
  }
  if (flags & QUESTION_FORMAT.DESCRIPTIVE) {
    list.push(QUESTION_FORMAT.DESCRIPTIVE);
  }
  return list;
}

function formatLabel(bit: QuestionFormatBit): string {
  switch (bit) {
    case QUESTION_FORMAT.SINGLE_CHOICE:
      return '単一選択';
    case QUESTION_FORMAT.MULTIPLE_CHOICE:
      return '複数選択';
    case QUESTION_FORMAT.DESCRIPTIVE:
      return '記述';
  }
}

function pickFormat(flags: number): QuestionFormatBit | null {
  const list = enabledFormats(flags);
  if (list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)]!;
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new Error('JSONオブジェクトを抽出できませんでした');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function normalizeDraft(raw: unknown): ExampleDraft {
  if (!raw || typeof raw !== 'object') {
    throw new Error('生成結果の形式が不正です');
  }
  const obj = raw as Record<string, unknown>;
  const choicesRaw = Array.isArray(obj.choices) ? obj.choices : [];
  const choices: ChoiceDraft[] = choicesRaw.map((item) => {
    const row = (item && typeof item === 'object' ? item : {}) as Record<
      string,
      unknown
    >;
    return {
      value: String(row.value ?? '').trim(),
      is_answer: Boolean(row.is_answer),
      reason: String(row.reason ?? '').trim(),
    };
  });

  return {
    title: String(obj.title ?? '').trim(),
    question: String(obj.question ?? '').trim(),
    answer: String(obj.answer ?? '').trim(),
    explanation: String(obj.explanation ?? '').trim(),
    choices: choices.filter((c) => c.value.length > 0),
  };
}

/** 保存時整合: answer空→選択式、非空→記述。形式ビットとも整合させる */
function passesIntegrity(draft: ExampleDraft, format: QuestionFormatBit): boolean {
  if (!draft.title || !draft.question || !draft.explanation) return false;

  const answerEmpty = draft.answer.length === 0;
  const correctCount = draft.choices.filter((c) => c.is_answer).length;

  if (format === QUESTION_FORMAT.DESCRIPTIVE) {
    return !answerEmpty && draft.choices.length === 0;
  }

  if (!answerEmpty) return false;
  if (draft.choices.length < 1) return false;
  if (correctCount < 1) return false;
  if (draft.choices.some((c) => !c.reason)) return false;

  if (format === QUESTION_FORMAT.SINGLE_CHOICE) {
    return correctCount === 1;
  }
  return correctCount >= 2;
}

async function callGemini(
  apiKey: string,
  prompt: string,
  model: string,
): Promise<string> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error('[generate-example] gemini error', res.status, detail);
    throw new Error(`Gemini API error (${res.status})`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? '')
    .join('')
    .trim();
  if (!text) {
    throw new Error('Gemini から空の応答が返りました');
  }
  return text;
}

function buildGeneratePrompt(args: {
  cert: CertRow;
  format: QuestionFormatBit;
  existing: Array<{ title: string; question: string }>;
}): string {
  const { cert, format, existing } = args;
  const existingBlock =
    existing.length === 0
      ? '（まだ例題はありません）'
      : existing
          .map(
            (e, i) =>
              `${i + 1}. タイトル: ${e.title}\n   問題先頭: ${e.question.slice(0, 120)}`,
          )
          .join('\n');

  const choiceHint =
    cert.choice_min != null || cert.choice_max != null
      ? `選択肢の個数は ${cert.choice_min ?? '？'}〜${cert.choice_max ?? '？'} 個程度にしてください。`
      : '選択肢の個数は、その資格試験でよくある規模にしてください。';

  const answerHint =
    cert.answer_max != null
      ? `正解の個数は最大 ${cert.answer_max} 個までにしてください。`
      : '';

  const formatRules =
    format === QUESTION_FORMAT.DESCRIPTIVE
      ? `形式は記述式です。
- answer に模範解答を入れる
- choices は必ず空配列 []
- explanation には、正解そのものではなく、次の類似問題にも活かせる考え方・着眼点を書く`
      : format === QUESTION_FORMAT.SINGLE_CHOICE
        ? `形式は単一選択です。
- answer は必ず空文字 ""
- choices に選択肢を入れる。is_answer が true のものはちょうど1つ
- 各 choice に reason（その選択肢が正しい/正しくない理由）を入れる
- explanation には、次の類似問題にも活かせる考え方・着眼点を書く（選択肢記号では参照せず、文言で述べる）
- ${choiceHint}
- ${answerHint}`
        : `形式は複数選択です。
- answer は必ず空文字 ""
- choices に選択肢を入れる。is_answer が true のものは2つ以上
- 各 choice に reason（その選択肢が正しい/正しくない理由）を入れる
- explanation には、次の類似問題にも活かせる考え方・着眼点を書く（選択肢記号では参照せず、文言で述べる）
- ${choiceHint}
- ${answerHint}`;

  return `あなたは資格試験「${cert.name}」の例題作成者です。
日本語で、本番に近い難易度・文体の例題を1問だけ作成してください。

出題形式: ${formatLabel(format)}

${formatRules}

既存例題とテーマ・問い方が重複しないようにしてください。
既存例題:
${existingBlock}

出力は次のJSONオブジェクトのみ（前後に説明文を付けない）:
{
  "title": "短いタイトル",
  "question": "問題文（選択式なら設問本文のみ。選択肢は choices へ）",
  "answer": "記述式なら模範解答。選択式なら空文字",
  "explanation": "次に活かせる考え方",
  "choices": [
    { "value": "選択肢本文", "is_answer": false, "reason": "正誤の理由" }
  ]
}`;
}

function buildReviewPrompt(args: {
  certName: string;
  format: QuestionFormatBit;
  draft: ExampleDraft;
  existing: Array<{ title: string; question: string }>;
}): string {
  const { certName, format, draft, existing } = args;
  return `あなたは資格試験「${certName}」の例題査読者です。
与えられた例題を精査し、事実誤認・正解と解説の矛盾・選択肢の不備・既存例題との過度な重複を修正してください。
形式「${formatLabel(format)}」の制約は必ず守ってください。
- 選択式なら answer は空文字、記述式なら choices は空
- 単一選択なら is_answer はちょうど1、複数選択なら2以上
- explanation は次に活かせる考え方。各 choice.reason は正誤理由
- 解説や reason で「選択肢A」など記号参照を使わず、文言で指す

既存例題（重複回避の参考）:
${
  existing.length === 0
    ? '（なし）'
    : existing.map((e) => `- ${e.title}`).join('\n')
}

元の例題JSON:
${JSON.stringify(draft, null, 2)}

出力は修正後の完成形JSONオブジェクトのみ（同じスキーマ）。`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, retryable: false, error: 'POST only' }, 405);
  }

  try {
    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    const geminiModel =
      Deno.env.get('GEMINI_MODEL')?.trim() || 'gemini-2.5-flash';
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!geminiKey || !supabaseUrl || !supabaseAnonKey) {
      return jsonResponse(
        {
          ok: false,
          retryable: false,
          error: 'サーバー設定が不足しています（GEMINI_API_KEY 等）',
        },
        500,
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse(
        { ok: false, retryable: false, error: '認証が必要です' },
        401,
      );
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return jsonResponse(
        { ok: false, retryable: false, error: 'ログインが必要です' },
        401,
      );
    }

    const body = (await req.json()) as { certification_id?: string };
    const certificationId = body.certification_id?.trim();
    if (!certificationId) {
      return jsonResponse(
        { ok: false, retryable: false, error: 'certification_id が必要です' },
        400,
      );
    }

    const { data: owned, error: ownedError } = await supabase
      .from('user_certifications')
      .select('id')
      .eq('certification_id', certificationId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (ownedError || !owned) {
      return jsonResponse(
        { ok: false, retryable: false, error: 'この資格にアクセスできません' },
        403,
      );
    }

    const { data: cert, error: certError } = await supabase
      .from('certifications')
      .select('id, name, question_format, choice_min, choice_max, answer_max')
      .eq('id', certificationId)
      .single();

    if (certError || !cert) {
      return jsonResponse(
        { ok: false, retryable: false, error: '資格が見つかりません' },
        404,
      );
    }

    const certRow = cert as CertRow;
    const format = pickFormat(certRow.question_format);
    if (!format) {
      return jsonResponse(
        {
          ok: false,
          retryable: false,
          error: 'question_format が未設定です。資格レコードを更新してください。',
        },
        400,
      );
    }

    const { data: existingRows, error: existingError } = await supabase
      .from('examples')
      .select('title, question')
      .eq('certification_id', certificationId)
      .order('created_at', { ascending: false })
      .limit(40);

    if (existingError) {
      console.error('[generate-example] existing', existingError);
      return jsonResponse(
        { ok: false, retryable: true, error: '既存例題の取得に失敗しました' },
        500,
      );
    }

    const existing = (existingRows ?? []) as Array<{
      title: string;
      question: string;
    }>;

    let draft = normalizeDraft(
      extractJsonObject(
        await callGemini(
          geminiKey,
          buildGeneratePrompt({ cert: certRow, format, existing }),
          geminiModel,
        ),
      ),
    );

    const { data: inserted, error: insertError } = await supabase
      .from('examples')
      .insert({
        certification_id: certificationId,
        title: draft.title || '無題の例題',
        question: draft.question || '（問題文未設定）',
        answer: draft.answer,
        explanation: draft.explanation || '（解説未設定）',
      })
      .select('id')
      .single();

    if (insertError || !inserted) {
      console.error('[generate-example] insert example', insertError);
      return jsonResponse(
        { ok: false, retryable: true, error: '例題の保存に失敗しました' },
        500,
      );
    }

    const exampleId = inserted.id as string;

    const cleanup = async () => {
      await supabase.from('examples').delete().eq('id', exampleId);
    };

    try {
      if (draft.choices.length > 0) {
        const { error: choiceInsertError } = await supabase
          .from('select_answer')
          .insert(
            draft.choices.map((c) => ({
              example_id: exampleId,
              value: c.value,
              is_answer: c.is_answer,
              reason: c.reason,
            })),
          );
        if (choiceInsertError) {
          console.error('[generate-example] insert choices', choiceInsertError);
          await cleanup();
          return jsonResponse(
            { ok: false, retryable: true, error: '選択肢の保存に失敗しました' },
            500,
          );
        }
      }

      draft = normalizeDraft(
        extractJsonObject(
          await callGemini(
            geminiKey,
            buildReviewPrompt({
              certName: certRow.name,
              format,
              draft,
              existing,
            }),
            geminiModel,
          ),
        ),
      );

      const { error: updateError } = await supabase
        .from('examples')
        .update({
          title: draft.title || '無題の例題',
          question: draft.question || '（問題文未設定）',
          answer: draft.answer,
          explanation: draft.explanation || '（解説未設定）',
        })
        .eq('id', exampleId);

      if (updateError) {
        console.error('[generate-example] update example', updateError);
        await cleanup();
        return jsonResponse(
          { ok: false, retryable: true, error: '査読結果の保存に失敗しました' },
          500,
        );
      }

      await supabase.from('select_answer').delete().eq('example_id', exampleId);
      if (draft.choices.length > 0) {
        const { error: choiceReplaceError } = await supabase
          .from('select_answer')
          .insert(
            draft.choices.map((c) => ({
              example_id: exampleId,
              value: c.value,
              is_answer: c.is_answer,
              reason: c.reason,
            })),
          );
        if (choiceReplaceError) {
          console.error('[generate-example] replace choices', choiceReplaceError);
          await cleanup();
          return jsonResponse(
            {
              ok: false,
              retryable: true,
              error: '査読後の選択肢保存に失敗しました',
            },
            500,
          );
        }
      }

      if (!passesIntegrity(draft, format)) {
        await cleanup();
        return jsonResponse({
          ok: false,
          retryable: true,
          error: '整合チェックに失敗したため再作成します',
        });
      }

      return jsonResponse({
        ok: true,
        example: {
          id: exampleId,
          title: draft.title,
          question: draft.question,
          answer: draft.answer,
          explanation: draft.explanation,
          format,
        },
      });
    } catch (inner) {
      console.error('[generate-example] after insert', inner);
      await cleanup();
      return jsonResponse({
        ok: false,
        retryable: true,
        error:
          inner instanceof Error ? inner.message : '生成処理中にエラーが発生しました',
      });
    }
  } catch (error) {
    console.error('[generate-example] fatal', error);
    return jsonResponse({
      ok: false,
      retryable: true,
      error: error instanceof Error ? error.message : '不明なエラー',
    });
  }
});
