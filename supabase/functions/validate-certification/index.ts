import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const QUESTION_FORMAT = {
  SINGLE_CHOICE: 1,
  MULTIPLE_CHOICE: 2,
  DESCRIPTIVE: 4,
} as const;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

type IdentifyDraft = {
  status: 'matched' | 'ambiguous' | 'not_found';
  candidate_count: number;
  official_name: string;
  summary: string;
  official_url: string;
  question_format: number;
  choice_min: number | null;
  choice_max: number | null;
  answer_max: number | null;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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

function toNullableInt(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function normalizeIdentify(raw: unknown): IdentifyDraft {
  if (!raw || typeof raw !== 'object') {
    throw new Error('照合結果の形式が不正です');
  }
  const obj = raw as Record<string, unknown>;
  const statusRaw = String(obj.status ?? '').trim();
  const status =
    statusRaw === 'matched' ||
    statusRaw === 'ambiguous' ||
    statusRaw === 'not_found'
      ? statusRaw
      : 'not_found';

  const flags = Math.max(0, Math.trunc(Number(obj.question_format ?? 0)) || 0);
  // 許可ビットのみ残す
  const question_format =
    (flags & QUESTION_FORMAT.SINGLE_CHOICE) |
    (flags & QUESTION_FORMAT.MULTIPLE_CHOICE) |
    (flags & QUESTION_FORMAT.DESCRIPTIVE);

  return {
    status,
    candidate_count: Math.max(
      0,
      Math.trunc(Number(obj.candidate_count ?? 0)) || 0,
    ),
    official_name: String(obj.official_name ?? '').trim(),
    summary: String(obj.summary ?? '').trim(),
    official_url: String(obj.official_url ?? '').trim(),
    question_format,
    choice_min: toNullableInt(obj.choice_min),
    choice_max: toNullableInt(obj.choice_max),
    answer_max: toNullableInt(obj.answer_max),
  };
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
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error('[validate-certification] gemini error', res.status, detail);
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

function buildIdentifyPrompt(query: string): string {
  return `あなたは資格試験の照合担当です。ユーザー入力が指す資格を特定してください。
問題作成は行いません。照合のみです。

ユーザー入力: 「${query}」

ルール:
- 実在する資格・認定試験のみを対象にする
- 主候補を1件に絞れるときだけ status を "matched" にする
- 複数の有力候補があり1件に絞れないときは status を "ambiguous"、candidate_count に有力候補数
- 資格として特定できないときは status を "not_found"
- matched のとき:
  - official_name は一般的な正式名称（日本語があれば日本語優先）
  - summary はユーザー確認用の短い説明（1〜2文）
  - official_url は公式の案内ページURL（不明なら空文字。推測で偽ドメインを作らない）
  - question_format はビットフラグ: 1=単一選択, 2=複数選択, 4=記述。該当するものを OR
  - choice_min / choice_max / answer_max は本番に近い目安（不明なら null）
- ambiguous / not_found のとき、official_name 等は空でよい。question_format は 0

出力はJSONオブジェクトのみ:
{
  "status": "matched" | "ambiguous" | "not_found",
  "candidate_count": 1,
  "official_name": "",
  "summary": "",
  "official_url": "",
  "question_format": 0,
  "choice_min": null,
  "choice_max": null,
  "answer_max": null
}`;
}

function buildFormatReviewPrompt(draft: IdentifyDraft): string {
  return `あなたは資格の出題形式査読担当です。照合結果の出題形式を検証・修正してください。
資格名の再照合や問題作成はしません。

対象資格: ${draft.official_name}
概要: ${draft.summary}
照合側の提案:
${JSON.stringify(
  {
    question_format: draft.question_format,
    choice_min: draft.choice_min,
    choice_max: draft.choice_max,
    answer_max: draft.answer_max,
  },
  null,
  2,
)}

ルール:
- question_format はビットのみ使用: 1=単一選択, 2=複数選択, 4=記述
- 本番試験で使われる形式だけを立てる。根拠が弱い形式は落とす
- どれにも当てはまらない／不明なら question_format を 0
- choice_min / choice_max / answer_max は選択式がある場合の目安。記述のみなら null 可
- choice_min <= choice_max、answer_max は妥当な正の整数（不明は null）
- official_name / summary / official_url / status / candidate_count は変更しない

出力は照合と同じスキーマのJSONオブジェクトのみ。status は必ず "matched"、candidate_count は 1。`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse(
      { ok: false, error_code: 'invalid', error: 'POST only' },
      405,
    );
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
          error_code: 'invalid',
          error: 'サーバー設定が不足しています（GEMINI_API_KEY 等）',
        },
        500,
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse(
        { ok: false, error_code: 'invalid', error: '認証が必要です' },
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
        { ok: false, error_code: 'invalid', error: 'ログインが必要です' },
        401,
      );
    }

    const body = (await req.json()) as { query?: string };
    const query = body.query?.trim() ?? '';
    if (!query) {
      return jsonResponse(
        {
          ok: false,
          error_code: 'invalid',
          error: '資格名を入力してください',
        },
        400,
      );
    }

    // --- ロール1: 照合 ---
    let identified = normalizeIdentify(
      extractJsonObject(
        await callGemini(geminiKey, buildIdentifyPrompt(query), geminiModel),
      ),
    );

    if (identified.status === 'not_found' || identified.candidate_count === 0) {
      return jsonResponse({
        ok: false,
        error_code: 'not_found',
        error: '資格を特定できませんでした。名称を見直して再度お試しください。',
      });
    }

    if (
      identified.status === 'ambiguous' ||
      identified.candidate_count > 1 ||
      !identified.official_name
    ) {
      return jsonResponse({
        ok: false,
        error_code: 'ambiguous',
        error:
          '資格を1件に特定できませんでした。より具体的な名称で再度お試しください。',
      });
    }

    // --- ロール2: 形式査読 ---
    const reviewed = normalizeIdentify(
      extractJsonObject(
        await callGemini(
          geminiKey,
          buildFormatReviewPrompt(identified),
          geminiModel,
        ),
      ),
    );

    const finalCandidate: IdentifyDraft = {
      ...identified,
      question_format: reviewed.question_format,
      choice_min: reviewed.choice_min,
      choice_max: reviewed.choice_max,
      answer_max: reviewed.answer_max,
      status: 'matched',
      candidate_count: 1,
    };

    if (!finalCandidate.official_name) {
      return jsonResponse({
        ok: false,
        error_code: 'not_found',
        error: '資格を特定できませんでした。名称を見直して再度お試しください。',
      });
    }

    if (finalCandidate.question_format === 0) {
      return jsonResponse({
        ok: false,
        error_code: 'unsupported_format',
        error:
          '対応する出題形式が存在しないため、作成できません。',
      });
    }

    return jsonResponse({
      ok: true,
      candidate: {
        official_name: finalCandidate.official_name,
        summary: finalCandidate.summary,
        official_url: finalCandidate.official_url,
        question_format: finalCandidate.question_format,
        choice_min: finalCandidate.choice_min,
        choice_max: finalCandidate.choice_max,
        answer_max: finalCandidate.answer_max,
      },
    });
  } catch (error) {
    console.error('[validate-certification] fatal', error);
    return jsonResponse(
      {
        ok: false,
        error_code: 'invalid',
        error:
          error instanceof Error
            ? error.message
            : '資格の照合中にエラーが発生しました',
      },
      500,
    );
  }
});
