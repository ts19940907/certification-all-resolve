import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

type ChoiceRow = {
  value: string;
  is_answer: boolean;
  reason: string | null;
};

type ExampleRow = {
  id: string;
  certification_id: string;
  title: string;
  question: string;
  answer: string;
  explanation: string | null;
  select_answer: ChoiceRow[] | ChoiceRow | null;
};

type DiagramDraft = {
  question_ask: {
    summary: string;
    points: string[];
    trap: string;
  };
  choices: Array<{
    label: string;
    gist: string;
    verdict: 'correct' | 'incorrect' | 'neutral';
    note: string;
  }>;
  explanation: {
    conclusion: string;
    why: string[];
    steps: string[];
  };
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function toChoiceList(raw: ChoiceRow[] | ChoiceRow | null): ChoiceRow[] {
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? '').trim())
    .filter((item) => item.length > 0);
}

function normalizeDiagram(raw: unknown, choices: ChoiceRow[]): DiagramDraft {
  if (!raw || typeof raw !== 'object') {
    throw new Error('図解結果の形式が不正です');
  }
  const obj = raw as Record<string, unknown>;
  const askRaw =
    obj.question_ask && typeof obj.question_ask === 'object'
      ? (obj.question_ask as Record<string, unknown>)
      : {};
  const expRaw =
    obj.explanation && typeof obj.explanation === 'object'
      ? (obj.explanation as Record<string, unknown>)
      : {};

  const choiceItemsRaw = Array.isArray(obj.choices) ? obj.choices : [];
  const choiceItems = choiceItemsRaw.map((item, index) => {
    const row =
      item && typeof item === 'object'
        ? (item as Record<string, unknown>)
        : {};
    const verdictRaw = String(row.verdict ?? '').trim();
    const verdict =
      verdictRaw === 'correct' ||
      verdictRaw === 'incorrect' ||
      verdictRaw === 'neutral'
        ? verdictRaw
        : choices[index]?.is_answer
          ? 'correct'
          : 'incorrect';
    const fallbackLabel = String.fromCharCode('A'.charCodeAt(0) + index);
    return {
      label: String(row.label ?? fallbackLabel).trim() || fallbackLabel,
      gist: String(row.gist ?? '').trim(),
      verdict,
      note: String(row.note ?? '').trim(),
    };
  });

  // 選択式なら件数を揃える（足りなければ補完）
  if (choices.length > 0) {
    while (choiceItems.length < choices.length) {
      const i = choiceItems.length;
      choiceItems.push({
        label: String.fromCharCode('A'.charCodeAt(0) + i),
        gist: choices[i]?.value ?? '',
        verdict: choices[i]?.is_answer ? 'correct' : 'incorrect',
        note: choices[i]?.reason?.trim() ?? '',
      });
    }
  }

  return {
    question_ask: {
      summary: String(askRaw.summary ?? '').trim(),
      points: asStringArray(askRaw.points),
      trap: String(askRaw.trap ?? '').trim(),
    },
    choices: choiceItems,
    explanation: {
      conclusion: String(expRaw.conclusion ?? '').trim(),
      why: asStringArray(expRaw.why),
      steps: asStringArray(expRaw.steps),
    },
  };
}

function buildExampleContext(example: ExampleRow, choices: ChoiceRow[]): string {
  const choiceBlock =
    choices.length === 0
      ? '（記述式）'
      : choices
          .map((c, i) => {
            const mark = String.fromCharCode('A'.charCodeAt(0) + i);
            const flag = c.is_answer ? '【正解】' : '';
            const reason = c.reason?.trim() ? ` / 理由: ${c.reason.trim()}` : '';
            return `- ${mark}. ${c.value}${flag}${reason}`;
          })
          .join('\n');

  const answerBlock =
    example.answer?.trim().length > 0
      ? `模範解答:\n${example.answer.trim()}`
      : `正解選択肢:\n${
          choices
            .filter((c) => c.is_answer)
            .map((c) => `- ${c.value}`)
            .join('\n') || '（なし）'
        }`;

  return `タイトル: ${example.title || '（無題）'}
問題文:
${example.question}

選択肢:
${choiceBlock}

${answerBlock}

解説:
${example.explanation?.trim() || '（なし）'}`;
}

function buildPrompt(args: {
  certName: string;
  exampleContext: string;
  isSelect: boolean;
}): string {
  const choiceSchema = args.isSelect
    ? `"choices": [
    {
      "label": "A",
      "gist": "この選択肢が言っていることの要約（1〜2文）",
      "verdict": "correct | incorrect | neutral",
      "note": "なぜ正しい/誤りかの短い補足"
    }
  ]`
    : `"choices": []`;

  return `あなたは資格試験「${args.certName}」の図解教材ライターです。
次の例題を、初見でも腹落ちする図解用の要約JSONにしてください。
日本語のみ。事実は例題の正解・解説に忠実に。誇張や捏造は禁止。

必ず次の3部構成の情報を埋めてください。
1. question_ask … 問題文で何を問うているか
2. choices … 各選択肢が何を言っているか（記述式なら空配列）
3. explanation … 解説およびなぜその答えになるか

【例題】
${args.exampleContext}

出力は次のJSONオブジェクトのみ（前後に説明文を付けない）:
{
  "question_ask": {
    "summary": "この問題の問いの核心を1〜2文",
    "points": ["着目点1", "着目点2"],
    "trap": "ひっかけ・迷いやすい点（なければ空文字）"
  },
  ${choiceSchema},
  "explanation": {
    "conclusion": "正解とその結論を1〜2文",
    "why": ["正解になる理由1", "理由2"],
    "steps": ["考え方の順番1", "順番2", "順番3"]
  }
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
        temperature: 0.4,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error('[diagram-example] gemini error', res.status, detail);
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

    const body = (await req.json()) as { example_id?: string };
    const exampleId = body.example_id?.trim();
    if (!exampleId) {
      return jsonResponse({ ok: false, error: 'example_id が必要です' }, 400);
    }

    const { data: example, error: exampleError } = await supabase
      .from('examples')
      .select(
        `
        id,
        certification_id,
        title,
        question,
        answer,
        explanation,
        select_answer (
          value,
          is_answer,
          reason
        )
      `,
      )
      .eq('id', exampleId)
      .maybeSingle();

    if (exampleError) {
      console.error('[diagram-example] example', exampleError);
      return jsonResponse({ ok: false, error: '例題の取得に失敗しました' }, 500);
    }
    if (!example) {
      return jsonResponse({ ok: false, error: '例題が見つかりません' }, 404);
    }

    const exampleRow = example as unknown as ExampleRow;

    const { data: owned, error: ownedError } = await supabase
      .from('user_certifications')
      .select('id')
      .eq('certification_id', exampleRow.certification_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (ownedError || !owned) {
      return jsonResponse(
        { ok: false, error: 'この例題にアクセスできません' },
        403,
      );
    }

    const { data: cert, error: certError } = await supabase
      .from('certifications')
      .select('name')
      .eq('id', exampleRow.certification_id)
      .maybeSingle();

    if (certError || !cert) {
      return jsonResponse({ ok: false, error: '資格情報の取得に失敗しました' }, 500);
    }

    const choices = toChoiceList(exampleRow.select_answer);
    const prompt = buildPrompt({
      certName: String((cert as { name: string }).name),
      exampleContext: buildExampleContext(exampleRow, choices),
      isSelect: choices.length > 0,
    });

    const rawText = await callGemini(geminiKey, prompt, geminiModel);
    const diagram = normalizeDiagram(extractJsonObject(rawText), choices);

    return jsonResponse({
      ok: true,
      diagram: {
        title: exampleRow.title || '例題図解',
        question: exampleRow.question,
        ...diagram,
      },
    });
  } catch (error) {
    console.error('[diagram-example] unexpected', error);
    return jsonResponse(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : '図解の作成に失敗しました',
      },
      500,
    );
  }
});
