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
  image_brief: string;
  category_name: string;
};

type CertRow = {
  id: string;
  name: string;
  question_format: number;
  choice_min: number | null;
  choice_max: number | null;
  answer_max: number | null;
};

type InlineImage = {
  mime_type: string;
  data_base64: string;
};

type RequestBody = {
  certification_id?: string;
  mode?: 'auto' | 'conditioned';
  format?: 'auto' | number;
  keywords?: string;
  reference_url?: string;
  image?: InlineImage | null;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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

function resolveFormat(
  flags: number,
  requested: 'auto' | number | undefined,
): QuestionFormatBit | null {
  if (requested == null || requested === 'auto') {
    return pickFormat(flags);
  }
  const bit = Number(requested) as QuestionFormatBit;
  if (
    bit !== QUESTION_FORMAT.SINGLE_CHOICE &&
    bit !== QUESTION_FORMAT.MULTIPLE_CHOICE &&
    bit !== QUESTION_FORMAT.DESCRIPTIVE
  ) {
    return null;
  }
  if ((flags & bit) === 0) return null;
  return bit;
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
    image_brief: String(obj.image_brief ?? '').trim(),
    category_name: String(obj.category_name ?? '').trim(),
  };
}

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

type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

async function callGemini(args: {
  apiKey: string;
  model: string;
  parts: GeminiPart[];
  responseMimeType?: string;
  responseModalities?: string[];
}): Promise<{
  text: string;
  images: Array<{ mime_type: string; data_base64: string }>;
}> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${args.model}:generateContent?key=${args.apiKey}`;

  const generationConfig: Record<string, unknown> = {
    temperature: 0.7,
  };
  if (args.responseMimeType) {
    generationConfig.responseMimeType = args.responseMimeType;
  }
  if (args.responseModalities) {
    generationConfig.responseModalities = args.responseModalities;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: args.parts }],
      generationConfig,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error('[generate-example] gemini error', res.status, detail);
    throw new Error(`Gemini API error (${res.status})`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          inlineData?: { mimeType?: string; data?: string };
          inline_data?: { mime_type?: string; data?: string };
        }>;
      };
    }>;
  };

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  const images: Array<{ mime_type: string; data_base64: string }> = [];
  for (const part of parts) {
    const inline = part.inlineData ?? part.inline_data;
    const mime = inline?.mimeType ?? inline?.mime_type;
    const b64 = inline?.data;
    if (mime && b64) {
      images.push({ mime_type: mime, data_base64: b64 });
    }
  }

  return { text, images };
}

async function callGeminiJson(
  apiKey: string,
  model: string,
  parts: GeminiPart[],
): Promise<unknown> {
  const { text } = await callGemini({
    apiKey,
    model,
    parts,
    responseMimeType: 'application/json',
  });
  if (!text) {
    throw new Error('Gemini から空の応答が返りました');
  }
  return extractJsonObject(text);
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchReferenceText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'CertResolveBot/1.0',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    if (!res.ok) {
      throw new Error(`参考リンクの取得に失敗しました（HTTP ${res.status}）`);
    }
    const contentType = res.headers.get('content-type') ?? '';
    const raw = await res.text();
    const text = contentType.includes('html') ? stripHtml(raw) : raw.trim();
    if (!text) {
      throw new Error('参考リンクから本文を取得できませんでした');
    }
    return text.slice(0, 14000);
  } finally {
    clearTimeout(timer);
  }
}

async function extractReferenceFacts(args: {
  apiKey: string;
  model: string;
  certName: string;
  url: string;
  pageText: string;
}): Promise<string> {
  const raw = await callGeminiJson(args.apiKey, args.model, [
    {
      text: `あなたは資格試験「${args.certName}」の出題作成者です。
次の参考ページ本文から、例題に使えそうな事実・要件・注意点だけを日本語で抜き出してください。
宣伝・ナビ・フッターは無視。最大8項目。各項目は1〜2文。

参考URL: ${args.url}

本文:
${args.pageText}

出力JSONのみ:
{ "facts": ["..."] }`,
    },
  ]);
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const facts = Array.isArray(obj.facts)
    ? obj.facts.map((f) => String(f).trim()).filter(Boolean)
    : [];
  return facts.length > 0
    ? facts.map((f, i) => `${i + 1}. ${f}`).join('\n')
    : '（参考ページから抽出できる出題向け情報が少ない）';
}

async function judgeImageUsability(args: {
  apiKey: string;
  model: string;
  certName: string;
  image: InlineImage;
}): Promise<{ usable: boolean; reason: string }> {
  const raw = await callGeminiJson(args.apiKey, args.model, [
    {
      text: `あなたは資格試験「${args.certName}」の出題査読者です。
添付画像が、本番に近い例題の「問題文に載せる図」として使えるか判定してください。

usable=true の条件（目安）:
- 構成図・画面・表など、設問の根拠として読める
- 文字や要素が判読できる
- 試験問題として不適切（個人情報・無関係な写真・過度なノイズ等）でない

usable=false の例:
- 雰囲気だけの参考写真で設問に載せる図として不適切
- 読めない／内容が不明
- 試験図として使うには再構成が必要

出力JSONのみ:
{ "usable": true, "reason": "短い理由" }`,
    },
    {
      inline_data: {
        mime_type: args.image.mime_type,
        data: args.image.data_base64,
      },
    },
  ]);
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    usable: Boolean(obj.usable),
    reason: String(obj.reason ?? '').trim() || '判定理由なし',
  };
}

function buildGeneratePrompt(args: {
  cert: CertRow;
  format: QuestionFormatBit;
  existing: Array<{ title: string; question: string }>;
  conditioned: boolean;
  keywords: string;
  referenceFacts: string | null;
  imageMode: 'none' | 'use_attached' | 'needs_redraw';
  imageJudgeReason: string | null;
  categoryNames: string[];
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

  let conditionBlock = '';
  if (args.conditioned) {
    const lines: string[] = ['【指定条件】'];
    if (args.keywords) {
      lines.push(`キーワード（できるだけ反映）: ${args.keywords}`);
    }
    if (args.referenceFacts) {
      lines.push(`参考リンクから抽出した出題向け情報:\n${args.referenceFacts}`);
    }
    if (args.imageMode === 'use_attached') {
      lines.push(
        '添付画像は問題文に載せる図として使います。問題文は画像を見て解ける内容にしてください。image_brief には画像の要約を短く書いてください。',
      );
    } else if (args.imageMode === 'needs_redraw') {
      lines.push(
        `添付画像は参考にすぎず、出題用図としては不適切と判定されました（理由: ${args.imageJudgeReason ?? 'なし'}）。`,
      );
      lines.push(
        '問題には別の試験向け図を載せます。image_brief に、描き直す図の内容（要素・関係・ラベル）を具体的に書いてください。問題文はその図を前提にしてください。',
      );
    } else {
      lines.push('画像指定はありません。image_brief は空文字にしてください。');
    }
    conditionBlock = `${lines.join('\n')}\n`;
  }

  return `あなたは資格試験「${cert.name}」の例題作成者です。
日本語で、本番に近い難易度・文体の例題を1問だけ作成してください。

出題形式: ${formatLabel(format)}

${formatRules}

${conditionBlock}
既存例題とテーマ・問い方が重複しないようにしてください。
既存例題:
${existingBlock}

カテゴリ（必ず1つ、次のいずれかの名称を category_name にそのまま書く）:
${
  args.categoryNames.length === 0
    ? '（マスタ未整備のため category_name は空文字）'
    : args.categoryNames.map((n) => `- ${n}`).join('\n')
}

出力は次のJSONオブジェクトのみ（前後に説明文を付けない）:
{
  "title": "短いタイトル",
  "question": "問題文（選択式なら設問本文のみ。選択肢は choices へ。図がある場合は図を参照する書き方で）",
  "answer": "記述式なら模範解答。選択式なら空文字",
  "explanation": "次に活かせる考え方",
  "image_brief": "問題図の要約。不要なら空文字",
  "category_name": "上記カテゴリのいずれか",
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
  categoryNames: string[];
}): string {
  const { certName, format, draft, existing } = args;
  return `あなたは資格試験「${certName}」の例題査読者です。
与えられた例題を精査し、事実誤認・正解と解説の矛盾・選択肢の不備・既存例題との過度な重複を修正してください。
形式「${formatLabel(format)}」の制約は必ず守ってください。
- 選択式なら answer は空文字、記述式なら choices は空
- 単一選択なら is_answer はちょうど1、複数選択なら2以上
- explanation は次に活かせる考え方。各 choice.reason は正誤理由
- 解説や reason で「選択肢A」など記号参照を使わず、文言で指す
- image_brief は問題図の要約。図が不要なら空文字
- category_name は次のいずれか（マスタが空なら空文字）:
${
  args.categoryNames.length === 0
    ? '（なし）'
    : args.categoryNames.map((n) => `- ${n}`).join('\n')
}

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

function resolveCategoryId(
  categoryName: string,
  categories: Array<{ id: string; name: string }>,
): string | null {
  if (categories.length === 0) return null;
  const needle = categoryName.trim().toLowerCase();
  if (!needle) return categories[0]?.id ?? null;
  const exact = categories.find((c) => c.name.trim().toLowerCase() === needle);
  if (exact) return exact.id;
  const soft = categories.find(
    (c) =>
      c.name.trim().toLowerCase().includes(needle) ||
      needle.includes(c.name.trim().toLowerCase()),
  );
  return soft?.id ?? categories[0]?.id ?? null;
}

function normalizeMime(mime: string): string {
  const m = mime.trim().toLowerCase();
  if (m === 'image/jpg') return 'image/jpeg';
  return m;
}

function extensionForMime(mime: string): string {
  switch (normalizeMime(mime)) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'jpg';
  }
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function validateInlineImage(image: InlineImage): InlineImage | null {
  const mime = normalizeMime(image.mime_type || '');
  if (!ALLOWED_IMAGE_MIME.has(mime)) return null;
  const data = image.data_base64?.replace(/\s/g, '') ?? '';
  if (!data) return null;
  const approxBytes = Math.floor((data.length * 3) / 4);
  if (approxBytes <= 0 || approxBytes > MAX_IMAGE_BYTES) return null;
  return { mime_type: mime === 'image/jpg' ? 'image/jpeg' : mime, data_base64: data };
}

async function uploadQuestionImage(args: {
  admin: ReturnType<typeof createClient>;
  userId: string;
  certificationId: string;
  exampleId: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<string> {
  const ext = extensionForMime(args.mimeType);
  const path =
    `${args.userId}/${args.certificationId}/${args.exampleId}/question.${ext}`;
  const { error } = await args.admin.storage
    .from('example-images')
    .upload(path, args.bytes, {
      contentType: args.mimeType,
      upsert: true,
    });
  if (error) {
    console.error('[generate-example] storage upload', error);
    throw new Error('画像の保存に失敗しました');
  }
  return path;
}

async function generateRedrawnImage(args: {
  apiKey: string;
  imageModel: string;
  certName: string;
  draft: ExampleDraft;
  referenceImage: InlineImage;
}): Promise<{ mime_type: string; data_base64: string }> {
  const brief =
    args.draft.image_brief ||
    '試験問題向けの構成図。サービスや要素の関係がはっきり分かる図';
  const { images } = await callGemini({
    apiKey: args.apiKey,
    model: args.imageModel,
    responseModalities: ['TEXT', 'IMAGE'],
    parts: [
      {
        text: `資格試験「${args.certName}」の例題用に、問題文に載せる図を1枚生成してください。
参考画像はテーマの手がかりにすぎません。そのまま模写せず、試験向けに読みやすい図へ描き直してください。
ロゴや商標の正確な再現は不要。日本語ラベル可。白背景・シンプルな線画／ボックス図。

問題タイトル: ${args.draft.title}
問題文: ${args.draft.question}
図の要件: ${brief}

画像のみを生成してください。`,
      },
      {
        inline_data: {
          mime_type: args.referenceImage.mime_type,
          data: args.referenceImage.data_base64,
        },
      },
    ],
  });
  const image = images[0];
  if (!image) {
    throw new Error('出題用画像の再生成に失敗しました');
  }
  return image;
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
    const geminiImageModel =
      Deno.env.get('GEMINI_IMAGE_MODEL')?.trim() || 'gemini-2.5-flash-image';
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

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

    const body = (await req.json()) as RequestBody;
    const certificationId = body.certification_id?.trim();
    if (!certificationId) {
      return jsonResponse(
        { ok: false, retryable: false, error: 'certification_id が必要です' },
        400,
      );
    }

    const mode = body.mode === 'conditioned' ? 'conditioned' : 'auto';
    const keywords = String(body.keywords ?? '').trim();
    const referenceUrl = String(body.reference_url ?? '').trim();
    const requestedCategoryId = String(body.category_id ?? '').trim();
    const inlineImage = body.image ? validateInlineImage(body.image) : null;

    if (mode === 'conditioned') {
      const formatIsAuto = body.format == null || body.format === 'auto';
      if (formatIsAuto && !keywords && !referenceUrl && !inlineImage) {
        return jsonResponse(
          {
            ok: false,
            retryable: false,
            error:
              '条件付き生成では、形式の指定か、キーワード・画像・参考リンクのいずれかを入力してください。',
          },
          400,
        );
      }
      if (body.image && !inlineImage) {
        return jsonResponse(
          {
            ok: false,
            retryable: false,
            error:
              '画像は PNG / JPG / WebP（最大5MB）のみ対応しています。',
          },
          400,
        );
      }
      if (referenceUrl) {
        try {
          const parsed = new URL(referenceUrl);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error('invalid');
          }
        } catch {
          return jsonResponse(
            {
              ok: false,
              retryable: false,
              error: '参考リンクのURL形式が正しくありません。',
            },
            400,
          );
        }
      }
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
    const format =
      mode === 'conditioned'
        ? resolveFormat(certRow.question_format, body.format)
        : pickFormat(certRow.question_format);

    if (!format) {
      return jsonResponse(
        {
          ok: false,
          retryable: false,
          error:
            mode === 'conditioned'
              ? '指定の問題形式はこの資格では使えません。'
              : 'question_format が未設定です。資格レコードを更新してください。',
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

    const { data: categoryRows } = await supabase
      .from('certification_categories')
      .select('id, name')
      .eq('certification_id', certificationId)
      .order('sort_order', { ascending: true });
    const categories = (categoryRows ?? []) as Array<{
      id: string;
      name: string;
    }>;
    if (categories.length === 0) {
      return jsonResponse(
        {
          ok: false,
          retryable: false,
          error:
            'カテゴリマスタが未整備のため例題を作成できません。資格の分析マスタを用意してから再度お試しください。',
        },
        400,
      );
    }

    let forcedCategoryId: string | null = null;
    if (requestedCategoryId) {
      const hit = categories.find((c) => c.id === requestedCategoryId);
      if (!hit) {
        return jsonResponse(
          {
            ok: false,
            retryable: false,
            error: '指定されたカテゴリがマスタに存在しないため、例題を作成できません。',
          },
          400,
        );
      }
      forcedCategoryId = hit.id;
    }

    if (keywords) {
      const { data: keywordRows } = await supabase
        .from('certification_keywords')
        .select('name')
        .eq('certification_id', certificationId);
      const masterNames = (keywordRows ?? []).map((r) => String(r.name ?? ''));
      const tokens = keywords
        .split(/[,、/\n]+/)
        .map((part) => part.trim())
        .filter(Boolean);
      const normalize = (name: string) =>
        name
          .trim()
          .toLowerCase()
          .replace(/[\s_\-　]+/g, '')
          .replace(/[（(].*$/, '');
      const masters = masterNames.map((name) => ({
        name,
        key: normalize(name),
      }));
      const unmatched = tokens.filter((token) => {
        const key = normalize(token);
        if (!key) return false;
        return !masters.some(
          (m) => m.key === key || m.key.includes(key) || key.includes(m.key),
        );
      });
      if (masterNames.length === 0 || unmatched.length > 0) {
        return jsonResponse(
          {
            ok: false,
            retryable: false,
            error:
              unmatched.length > 0
                ? `キーワードマスタと整合できないため例題を作成できません（不一致: ${unmatched.join('、')}）。`
                : 'キーワードマスタが未整備のため、キーワード指定では例題を作成できません。',
          },
          400,
        );
      }
    }

    const categoryNames = forcedCategoryId
      ? categories.filter((c) => c.id === forcedCategoryId).map((c) => c.name)
      : categories.map((c) => c.name);

    let referenceFacts: string | null = null;
    if (mode === 'conditioned' && referenceUrl) {
      try {
        const pageText = await fetchReferenceText(referenceUrl);
        referenceFacts = await extractReferenceFacts({
          apiKey: geminiKey,
          model: geminiModel,
          certName: certRow.name,
          url: referenceUrl,
          pageText,
        });
      } catch (error) {
        console.error('[generate-example] reference', error);
        return jsonResponse(
          {
            ok: false,
            retryable: true,
            error:
              error instanceof Error
                ? error.message
                : '参考リンクの処理に失敗しました',
          },
          502,
        );
      }
    }

    let imageMode: 'none' | 'use_attached' | 'needs_redraw' = 'none';
    let imageJudgeReason: string | null = null;
    if (mode === 'conditioned' && inlineImage) {
      const judgment = await judgeImageUsability({
        apiKey: geminiKey,
        model: geminiModel,
        certName: certRow.name,
        image: inlineImage,
      });
      imageMode = judgment.usable ? 'use_attached' : 'needs_redraw';
      imageJudgeReason = judgment.reason;
    }

    const generateParts: GeminiPart[] = [
      {
        text: buildGeneratePrompt({
          cert: certRow,
          format,
          existing,
          conditioned: mode === 'conditioned',
          keywords,
          referenceFacts,
          imageMode,
          imageJudgeReason,
          categoryNames,
        }),
      },
    ];
    if (inlineImage && imageMode !== 'none') {
      generateParts.push({
        inline_data: {
          mime_type: inlineImage.mime_type,
          data: inlineImage.data_base64,
        },
      });
    }

    let draft = normalizeDraft(
      await callGeminiJson(geminiKey, geminiModel, generateParts),
    );
    let categoryId =
      forcedCategoryId ?? resolveCategoryId(draft.category_name, categories);

    const { data: inserted, error: insertError } = await supabase
      .from('examples')
      .insert({
        certification_id: certificationId,
        user_id: user.id,
        title: draft.title || '無題の例題',
        question: draft.question || '（問題文未設定）',
        answer: draft.answer,
        explanation: draft.explanation || '（解説未設定）',
        category_id: categoryId,
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
    const admin =
      serviceRoleKey != null
        ? createClient(supabaseUrl, serviceRoleKey)
        : supabase;

    const cleanup = async () => {
      await supabase.from('examples').delete().eq('id', exampleId);
      if (serviceRoleKey) {
        const folder = `${user.id}/${certificationId}/${exampleId}`;
        await admin.storage.from('example-images').remove([
          `${folder}/question.png`,
          `${folder}/question.jpg`,
          `${folder}/question.webp`,
        ]);
      }
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
        await callGeminiJson(geminiKey, geminiModel, [
          {
            text: buildReviewPrompt({
              certName: certRow.name,
              format,
              draft,
              existing,
              categoryNames,
            }),
          },
        ]),
      );
      categoryId =
        forcedCategoryId ??
        resolveCategoryId(draft.category_name, categories);

      let questionImages: string[] = [];
      if (inlineImage && imageMode === 'use_attached') {
        const path = await uploadQuestionImage({
          admin,
          userId: user.id,
          certificationId,
          exampleId,
          mimeType: inlineImage.mime_type,
          bytes: decodeBase64(inlineImage.data_base64),
        });
        questionImages = [path];
      } else if (inlineImage && imageMode === 'needs_redraw') {
        const redrawn = await generateRedrawnImage({
          apiKey: geminiKey,
          imageModel: geminiImageModel,
          certName: certRow.name,
          draft,
          referenceImage: inlineImage,
        });
        const path = await uploadQuestionImage({
          admin,
          userId: user.id,
          certificationId,
          exampleId,
          mimeType: normalizeMime(redrawn.mime_type) || 'image/png',
          bytes: decodeBase64(redrawn.data_base64),
        });
        questionImages = [path];
      }

      const { error: updateError } = await supabase
        .from('examples')
        .update({
          title: draft.title || '無題の例題',
          question: draft.question || '（問題文未設定）',
          answer: draft.answer,
          explanation: draft.explanation || '（解説未設定）',
          question_images: questionImages,
          category_id: categoryId,
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
          question_images: questionImages,
        },
        image: inlineImage
          ? {
              used_original: imageMode === 'use_attached',
              redrawn: imageMode === 'needs_redraw',
              reason: imageJudgeReason,
            }
          : null,
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
