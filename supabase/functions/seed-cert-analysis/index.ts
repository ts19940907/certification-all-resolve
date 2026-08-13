import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

type Mode = 'ensure_masters' | 'assign_categories' | 'backfill_owned';

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

async function callGeminiJson(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<unknown> {
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
    console.error('[seed-cert-analysis] gemini', res.status, detail);
    throw new Error(`Gemini API error (${res.status})`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? '')
    .join('')
    .trim();
  if (!text) throw new Error('Gemini の応答が空です');
  return extractJsonObject(text);
}

function uniqueNames(raw: unknown, fallbackPrefix: string, max: number): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const name = String(item ?? '').trim().replace(/\s+/g, ' ');
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= max) break;
  }
  if (out.length === 0) {
    out.push(`${fallbackPrefix}1`, `${fallbackPrefix}2`, `${fallbackPrefix}3`);
  }
  return out;
}

async function ensureMasters(args: {
  supabase: ReturnType<typeof createClient>;
  apiKey: string;
  model: string;
  certificationId: string;
  certName: string;
}): Promise<{ categories: number; keywords: number; created: boolean }> {
  const { data: existingCats } = await args.supabase
    .from('certification_categories')
    .select('id')
    .eq('certification_id', args.certificationId)
    .limit(1);
  const { data: existingKws } = await args.supabase
    .from('certification_keywords')
    .select('id')
    .eq('certification_id', args.certificationId)
    .limit(1);

  const needCats = (existingCats ?? []).length === 0;
  const needKws = (existingKws ?? []).length === 0;
  if (!needCats && !needKws) {
    return { categories: 0, keywords: 0, created: false };
  }

  const draft = await callGeminiJson(
    args.apiKey,
    args.model,
    `あなたは資格試験の学習分析設計者です。次の資格向けに、学習進捗のレーダーチャート用カテゴリと、キーワード自己説明のマスタ候補を JSON だけで返してください。

資格名: ${args.certName}

要件:
- categories: 5〜12個。試験の出題領域を表す短い日本語名（例: ストレージ、ネットワーク、IAM）。「その他」は最後に1つ入れてよい
- keywords: 20〜60個。その資格で押さえるべき用語・サービス名・概念。重複なし
- 出力形式: {"categories":["..."],"keywords":["..."]}`,
  );

  const obj = (draft && typeof draft === 'object'
    ? (draft as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  let catCount = 0;
  let kwCount = 0;

  if (needCats) {
    const names = uniqueNames(obj.categories, 'カテゴリ', 12);
    const rows = names.map((name, i) => ({
      certification_id: args.certificationId,
      name,
      sort_order: i,
    }));
    const { error } = await args.supabase
      .from('certification_categories')
      .insert(rows);
    if (error) {
      console.error('[seed-cert-analysis] insert categories', error);
      throw new Error('カテゴリマスタの保存に失敗しました');
    }
    catCount = rows.length;
  }

  if (needKws) {
    const names = uniqueNames(obj.keywords, 'キーワード', 60);
    const rows = names.map((name, i) => ({
      certification_id: args.certificationId,
      name,
      sort_order: i,
    }));
    const { error } = await args.supabase
      .from('certification_keywords')
      .insert(rows);
    if (error) {
      console.error('[seed-cert-analysis] insert keywords', error);
      throw new Error('キーワードマスタの保存に失敗しました');
    }
    kwCount = rows.length;
  }

  return { categories: catCount, keywords: kwCount, created: true };
}

async function assignCategories(args: {
  supabase: ReturnType<typeof createClient>;
  apiKey: string;
  model: string;
  certificationId: string;
  certName: string;
}): Promise<{ assigned: number }> {
  const { data: categories, error: catError } = await args.supabase
    .from('certification_categories')
    .select('id, name')
    .eq('certification_id', args.certificationId)
    .order('sort_order', { ascending: true });

  if (catError) throw catError;
  if (!categories || categories.length === 0) {
    return { assigned: 0 };
  }

  const { data: examples, error: exError } = await args.supabase
    .from('examples')
    .select('id, title, question')
    .eq('certification_id', args.certificationId)
    .is('category_id', null)
    .order('created_at', { ascending: true });

  if (exError) throw exError;
  if (!examples || examples.length === 0) {
    return { assigned: 0 };
  }

  const catLines = categories
    .map((c, i) => `${i + 1}. id=${c.id} name=${c.name}`)
    .join('\n');

  let assigned = 0;
  const chunkSize = 15;
  for (let i = 0; i < examples.length; i += chunkSize) {
    const chunk = examples.slice(i, i + chunkSize);
    const exLines = chunk
      .map(
        (e, idx) =>
          `${idx + 1}. id=${e.id}\n   title=${e.title}\n   question=${String(e.question).slice(0, 200)}`,
      )
      .join('\n');

    const draft = await callGeminiJson(
      args.apiKey,
      args.model,
      `資格「${args.certName}」の例題を、次のカテゴリのいずれかに分類してください。JSONのみ返してください。

カテゴリ一覧:
${catLines}

例題:
${exLines}

出力形式: {"assignments":[{"example_id":"uuid","category_id":"uuid"}]}
- すべての例題に必ず1つ付ける
- category_id は一覧の id のみ使用`,
    );

    const obj = (draft && typeof draft === 'object'
      ? (draft as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    const assignments = Array.isArray(obj.assignments) ? obj.assignments : [];
    const validIds = new Set(categories.map((c) => c.id as string));
    const fallbackId = categories[0].id as string;

    for (const example of chunk) {
      const hit = assignments.find(
        (a) =>
          a &&
          typeof a === 'object' &&
          String((a as Record<string, unknown>).example_id ?? '') === example.id,
      ) as Record<string, unknown> | undefined;
      let categoryId = String(hit?.category_id ?? '').trim();
      if (!validIds.has(categoryId)) {
        categoryId = fallbackId;
      }
      const { error } = await args.supabase
        .from('examples')
        .update({ category_id: categoryId })
        .eq('id', example.id)
        .is('category_id', null);
      if (!error) assigned += 1;
      else console.error('[seed-cert-analysis] update example', error);
    }
  }

  return { assigned };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    const geminiModel =
      Deno.env.get('GEMINI_MODEL')?.trim() || 'gemini-2.5-flash';

    if (!supabaseUrl || !anonKey || !geminiKey) {
      return jsonResponse(
        { ok: false, error: 'サーバー設定が不足しています' },
        500,
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ ok: false, error: '認証が必要です' }, 401);
    }

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ ok: false, error: '認証が必要です' }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as {
      mode?: Mode;
      certificationId?: string;
    };
    const mode = body.mode;
    if (
      mode !== 'ensure_masters' &&
      mode !== 'assign_categories' &&
      mode !== 'backfill_owned'
    ) {
      return jsonResponse({ ok: false, error: 'mode が不正です' }, 400);
    }

    if (mode === 'backfill_owned') {
      const { data: links, error } = await supabase
        .from('user_certifications')
        .select('certification_id, certification:certifications(id, name)')
        .eq('user_id', user.id);
      if (error) throw error;

      const results: Array<{
        certificationId: string;
        name: string;
        masters: unknown;
        assigned: number;
      }> = [];

      for (const link of links ?? []) {
        const cert = link.certification as
          | { id: string; name: string }
          | { id: string; name: string }[]
          | null;
        const row = Array.isArray(cert) ? cert[0] : cert;
        if (!row?.id) continue;
        const masters = await ensureMasters({
          supabase,
          apiKey: geminiKey,
          model: geminiModel,
          certificationId: row.id,
          certName: row.name,
        });
        const { assigned } = await assignCategories({
          supabase,
          apiKey: geminiKey,
          model: geminiModel,
          certificationId: row.id,
          certName: row.name,
        });
        results.push({
          certificationId: row.id,
          name: row.name,
          masters,
          assigned,
        });
      }

      return jsonResponse({ ok: true, mode, results });
    }

    const certificationId = String(body.certificationId ?? '').trim();
    if (!certificationId) {
      return jsonResponse(
        { ok: false, error: 'certificationId が必要です' },
        400,
      );
    }

    const { data: owned } = await supabase
      .from('user_certifications')
      .select('id')
      .eq('user_id', user.id)
      .eq('certification_id', certificationId)
      .maybeSingle();
    if (!owned) {
      return jsonResponse(
        { ok: false, error: 'この資格を操作する権限がありません' },
        403,
      );
    }

    const { data: cert, error: certError } = await supabase
      .from('certifications')
      .select('id, name')
      .eq('id', certificationId)
      .single();
    if (certError || !cert) {
      return jsonResponse({ ok: false, error: '資格が見つかりません' }, 404);
    }

    if (mode === 'ensure_masters') {
      const masters = await ensureMasters({
        supabase,
        apiKey: geminiKey,
        model: geminiModel,
        certificationId,
        certName: cert.name,
      });
      return jsonResponse({ ok: true, mode, ...masters });
    }

    const masters = await ensureMasters({
      supabase,
      apiKey: geminiKey,
      model: geminiModel,
      certificationId,
      certName: cert.name,
    });
    const { assigned } = await assignCategories({
      supabase,
      apiKey: geminiKey,
      model: geminiModel,
      certificationId,
      certName: cert.name,
    });
    return jsonResponse({ ok: true, mode, masters, assigned });
  } catch (error) {
    console.error('[seed-cert-analysis]', error);
    return jsonResponse(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : '分析マスタの処理に失敗しました',
      },
      500,
    );
  }
});
