import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const MAX_TURNS = 10;

type ChatRole = 'user' | 'assistant';

type ChatMessageIn = {
  role?: string;
  text?: string;
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizeMessages(raw: unknown): Array<{ role: ChatRole; text: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ role: ChatRole; text: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as ChatMessageIn;
    const role = row.role === 'assistant' ? 'assistant' : row.role === 'user' ? 'user' : null;
    const text = String(row.text ?? '').trim();
    if (!role || !text) continue;
    out.push({ role, text });
  }
  return out;
}

function takeRecentTurns(
  messages: Array<{ role: ChatRole; text: string }>,
  maxTurns: number,
) {
  const maxMessages = maxTurns * 2;
  if (messages.length <= maxMessages) return messages;
  return messages.slice(messages.length - maxMessages);
}

function toChoiceList(raw: ChoiceRow[] | ChoiceRow | null): ChoiceRow[] {
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
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
  messages: Array<{ role: ChatRole; text: string }>;
}): string {
  const history = args.messages
    .map((m) => `${m.role === 'user' ? '学習者' : '先生'}: ${m.text}`)
    .join('\n\n');

  return `あなたは資格試験「${args.certName}」の先生役AIです。
学習者はこの例題の解説を読んでもわからない点を質問しています。
例題の内容に沿って、日本語でわかりやすく答えてください。
推測で断定しすぎず、必要なら根拠や考え方も示してください。
回答だけを返してください（前置きやメタ説明は不要）。

【例題】
${args.exampleContext}

【これまでのやり取り】
${history || '（なし）'}

上の最新の学習者の質問に答えてください。`;
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
        temperature: 0.5,
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error('[ask-example] gemini error', res.status, detail);
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
      example_id?: string;
      messages?: unknown;
    };
    const exampleId = body.example_id?.trim();
    if (!exampleId) {
      return jsonResponse({ ok: false, error: 'example_id が必要です' }, 400);
    }

    const messages = takeRecentTurns(normalizeMessages(body.messages), MAX_TURNS);
    if (messages.length === 0 || messages[messages.length - 1]?.role !== 'user') {
      return jsonResponse(
        { ok: false, error: '最新のユーザー質問が必要です' },
        400,
      );
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
      console.error('[ask-example] example', exampleError);
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
      messages,
    });

    const reply = await callGemini(geminiKey, prompt, geminiModel);
    return jsonResponse({ ok: true, reply });
  } catch (error) {
    console.error('[ask-example] unexpected', error);
    return jsonResponse(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : '質問への回答に失敗しました',
      },
      500,
    );
  }
});
