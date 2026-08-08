import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

type Grade = 'A' | 'B' | 'C' | 'D';

type ReviewDraft = {
  grade: Grade;
  reason: string;
  good_points: string;
  bad_points: string;
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

function normalizeReview(raw: unknown): ReviewDraft {
  if (!raw || typeof raw !== 'object') {
    throw new Error('レビュー結果の形式が不正です');
  }
  const obj = raw as Record<string, unknown>;
  const gradeRaw = String(obj.grade ?? '')
    .trim()
    .toUpperCase();
  const grade: Grade =
    gradeRaw === 'A' || gradeRaw === 'B' || gradeRaw === 'C' || gradeRaw === 'D'
      ? gradeRaw
      : 'C';

  return {
    grade,
    reason: String(obj.reason ?? '').trim(),
    good_points: String(obj.good_points ?? '').trim(),
    bad_points: String(obj.bad_points ?? '').trim(),
  };
}

function buildPrompt(args: {
  certName: string;
  keyword: string;
  explanation: string;
}): string {
  return `あなたは資格試験「${args.certName}」の学習コーチです。
学習者がキーワードについて自分の言葉で説明した内容を読み、理解度を評価してください。

評価基準（Aが最高、Dが最低）:
- A: 定義・要点・使い所が正確で、誤解がほぼない
- B: おおむね正しいが、重要な欠落や少しの曖昧さがある
- C: 一部分は触れているが、誤解・不足が多く実務/試験では危うい
- D: 的外れ、重大な誤解、または説明として成立していない

ルール:
- 日本語で返す
- 厳しすぎず優しすぎず、学習に役立つ具体性を優先する
- 良い点と悪い点はそれぞれまとまった文章で書く（箇条書きではなく文章）
- キーワードの一般知識に照らして評価する（資格コンテキストも考慮）

キーワード: ${args.keyword}

学習者の説明:
${args.explanation}

出力は次のJSONオブジェクトのみ:
{
  "grade": "A | B | C | D",
  "reason": "なぜその評価になったかの理由（2〜4文）",
  "good_points": "良い点をまとめた文章",
  "bad_points": "改善が必要な点・悪い点をまとめた文章"
}`;
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
        temperature: 0.35,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error('[review-keyword] gemini error', res.status, detail);
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'POST only' }, 405);
  }

  try {
    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    const geminiModel =
      Deno.env.get('GEMINI_MODEL')?.trim() || 'gemini-2.5-flash';
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!geminiKey || !supabaseUrl || !supabaseAnonKey) {
      return jsonResponse(
        { ok: false, error: 'サーバー設定が不足しています（GEMINI_API_KEY 等）' },
        500,
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ ok: false, error: '認証が必要です' }, 401);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ ok: false, error: 'ログインが必要です' }, 401);
    }

    const body = (await req.json()) as {
      certification_id?: string;
      keyword?: string;
      explanation?: string;
    };

    const certificationId = body.certification_id?.trim();
    const keyword = body.keyword?.trim() ?? '';
    const explanation = body.explanation?.trim() ?? '';

    if (!certificationId) {
      return jsonResponse(
        { ok: false, error: 'certification_id が必要です' },
        400,
      );
    }
    if (!keyword) {
      return jsonResponse({ ok: false, error: 'キーワードが必要です' }, 400);
    }
    if (!explanation) {
      return jsonResponse({ ok: false, error: '説明が必要です' }, 400);
    }

    const { data: owned, error: ownedError } = await supabase
      .from('user_certifications')
      .select('id')
      .eq('certification_id', certificationId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (ownedError || !owned) {
      return jsonResponse(
        { ok: false, error: 'この資格にアクセスできません' },
        403,
      );
    }

    const { data: cert, error: certError } = await supabase
      .from('certifications')
      .select('name')
      .eq('id', certificationId)
      .maybeSingle();

    if (certError || !cert) {
      return jsonResponse({ ok: false, error: '資格情報の取得に失敗しました' }, 500);
    }

    const prompt = buildPrompt({
      certName: String((cert as { name: string }).name),
      keyword,
      explanation,
    });
    const rawText = await callGemini(geminiKey, prompt, geminiModel);
    const review = normalizeReview(extractJsonObject(rawText));

    return jsonResponse({
      ok: true,
      review: {
        keyword,
        explanation,
        ...review,
      },
    });
  } catch (error) {
    console.error('[review-keyword] unexpected', error);
    return jsonResponse(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'キーワードレビューに失敗しました',
      },
      500,
    );
  }
});
