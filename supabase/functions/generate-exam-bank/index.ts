import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

/** SAP-C02: 150問 = 39 / 44 / 37 / 30（公式比率 26/29/25/20% に近似） */
const SAP_DOMAINS = [
  {
    key: 'organizational_complexity',
    label: 'Design Solutions for Organizational Complexity',
    categoryName: '組織の複雑さへの設計',
    weight: 26,
    fullCount: 39,
  },
  {
    key: 'new_solutions',
    label: 'Design for New Solutions',
    categoryName: '新規ソリューションの設計',
    weight: 29,
    fullCount: 44,
  },
  {
    key: 'continuous_improvement',
    label: 'Continuous Improvement for Existing Solutions',
    categoryName: '既存ソリューションの継続的改善',
    weight: 25,
    fullCount: 37,
  },
  {
    key: 'migration_modernization',
    label: 'Accelerate Workload Migration and Modernization',
    categoryName: '移行とモダナイゼーション',
    weight: 20,
    fullCount: 30,
  },
] as const;

type DomainKey = (typeof SAP_DOMAINS)[number]['key'];
type DomainMeta = (typeof SAP_DOMAINS)[number];

const TARGET_TOTAL = SAP_DOMAINS.reduce((s, d) => s + d.fullCount, 0); // 150
const BATCH_SIZE = 5;
/** SAP-C02 目安: 複数選択 20〜30% → 中央付近の 25%（38問） */
const MULTI_TARGET_TOTAL = 38;
const MULTI_MIN_RATIO = 0.2;
const MULTI_MAX_RATIO = 0.3;

const SCENARIO_TEMPLATES = [
  'マルチアカウント構成と AWS Organizations のガバナンス（SCP / OU 設計）',
  'オンプレミス併用のハイブリッド接続（Direct Connect / VPN / Transit Gateway）',
  'マルチリージョンの災害対策（RPO/RTO 付き、データベース中心）',
  'コスト最適化を最優先した既存ワークロード改善（Savings Plans / スポット / ストレージ階層）',
  '運用負荷を下げつつ高可用性を維持する設計（マネージドサービス移行）',
  'レガシーアプリの移行ウェーブ計画とカットオーバー（データベース同期）',
  'セキュリティ統制（IAM / SCP / 暗号化 / 検知）を含む新規ソリューション',
  'パフォーマンス目標を満たすデータ層・キャッシュ設計',
  'マルチアカウントのネットワーク分離と共有サービス VPC',
  'コンテナ基盤（ECS/EKS）のマルチAZ・権限設計',
  'データレイク（S3 / Lake Formation）と分析基盤の権限制御',
  'イベント駆動アーキテクチャ（EventBridge / SQS / Step Functions）の信頼性',
  'グローバルユーザー向け配信（CloudFront / Route 53 / オリジン障害）',
  '機密データを扱う SaaS のテナント分離と暗号化キー管理',
  '既存 VPC ピアリングから Transit Gateway への段階移行',
  '監査・コンプライアンスの自動化（Config / CloudTrail / Security Hub）',
  '大規模ファイル移行（DataSync / Transfer Family / S3）と帯域制約',
  'Blue/Green とカナリアによる低リスクリリース設計',
  'クロスアカウントのログ集約とインシデント対応フロー',
  'エッジ／ローカル要件（Outposts / Local Zones）と本拠地連携',
  'キャッシュとセッション管理を含むステートレス Web のスケールアウト',
  'データベース移行（DMS / SCT）とカットオーバー時の整合性担保',
  'コスト異常検知とタグ付けガバナンスの導入',
  'ゼロトラスト寄りの社内アクセス（VPN 代替 / Verified Access 等の現行サービス）',
] as const;

type ChoiceDraft = {
  value: string;
  is_answer: boolean;
  reason: string;
};

type QuestionDraft = {
  title: string;
  question: string;
  explanation: string;
  choices: ChoiceDraft[];
};

type AnswerMode = 'single' | 'multi';

type AdminClient = ReturnType<typeof createClient>;

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
  temperature = 0.4,
): Promise<unknown> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature,
        responseMimeType: 'application/json',
      },
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error('[generate-exam-bank] gemini', res.status, detail);
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

function isSapCertification(name: string, examCode: string | null): boolean {
  const code = (examCode ?? '').toUpperCase();
  if (code.includes('SAP-C02') || code === 'SAP') return true;
  const n = name.toLowerCase();
  return (
    (n.includes('solutions architect') && n.includes('professional')) ||
    (n.includes('ソリューションアーキテクト') &&
      n.includes('プロフェッショナル')) ||
    n.includes('sap-c02')
  );
}

function normalizeDraft(raw: unknown): QuestionDraft {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const choicesRaw = Array.isArray(obj.choices) ? obj.choices : [];
  const choices: ChoiceDraft[] = [];
  for (const item of choicesRaw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const value = String(row.value ?? '').trim();
    if (!value) continue;
    choices.push({
      value,
      is_answer: Boolean(row.is_answer),
      reason: String(row.reason ?? '').trim() || '（理由未設定）',
    });
  }
  return {
    title: String(obj.title ?? '').trim() || '無題の試験問題',
    question: String(obj.question ?? '').trim() || '（問題文未設定）',
    explanation: String(obj.explanation ?? '').trim() || '（解説未設定）',
    choices,
  };
}

function localValidate(draft: QuestionDraft, mode: AnswerMode): string[] {
  const issues: string[] = [];
  const answers = draft.choices.filter((c) => c.is_answer);
  if (mode === 'single') {
    if (draft.choices.length < 4) issues.push('単一選択は選択肢4つ以上必要です');
    if (answers.length !== 1) {
      issues.push('単一選択の正解はちょうど1つにしてください');
    }
  } else {
    if (draft.choices.length < 5) issues.push('複数選択は選択肢5つ以上必要です');
    if (answers.length !== 2) {
      issues.push('複数選択の正解はちょうど2つにしてください');
    }
  }
  if (draft.question.length < 40) issues.push('問題文が短すぎます');
  if (draft.title.length < 8) issues.push('タイトルが短すぎます');
  if (
    /練習問題|模擬問題|sap-?c02\s*#|通し番号/i.test(draft.title) ||
    /^aws\s*sap/i.test(draft.title.trim())
  ) {
    issues.push(
      'タイトルはシナリオ内容を表す具体名にしてください（練習問題番号形式は不可）',
    );
  }
  if (mode === 'multi' && !/2つ|二つ|ふたつ|choose\s*two|select\s*two/i.test(draft.question)) {
    issues.push('複数選択問題の本文に「2つ選べ」等の指示を入れてください');
  }
  for (const c of draft.choices) {
    if (!c.reason || c.reason.length < 8) {
      issues.push('各選択肢に十分な理由が必要です');
      break;
    }
  }
  return issues;
}

function normalizeForCompare(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[、。．，,.・:：;；()（）[\]「」『』\-ー]/g, '');
}

function sharedPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i += 1;
  return i;
}

function trigramSet(text: string): Set<string> {
  const s = normalizeForCompare(text);
  const out = new Set<string>();
  for (let i = 0; i < s.length - 2; i += 1) out.add(s.slice(i, i + 3));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function isTooSimilar(a: string, b: string): boolean {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (sharedPrefixLength(na, nb) >= 36) return true;
  return jaccard(trigramSet(na.slice(0, 180)), trigramSet(nb.slice(0, 180))) >= 0.42;
}

type ExistingBankFingerprints = {
  titles: string[];
  questions: string[];
};

function findDuplicateAgainstExisting(
  draft: QuestionDraft,
  existing: ExistingBankFingerprints,
): string | null {
  for (const title of existing.titles) {
    if (isTooSimilar(draft.title, title)) {
      return `タイトルが既存問題と類似しています（例: ${title.slice(0, 40)}）`;
    }
  }
  for (const question of existing.questions) {
    if (isTooSimilar(draft.question, question)) {
      return '問題文が既存問題と類似しています（別シナリオ・別制約で作り直してください）';
    }
  }
  return null;
}

async function loadExistingFingerprints(
  admin: AdminClient,
  certificationId: string,
): Promise<ExistingBankFingerprints> {
  const { data, error } = await admin
    .from('examples')
    .select('title, question')
    .eq('certification_id', certificationId)
    .is('user_id', null);
  if (error) throw new Error('既存バンクの取得に失敗しました');
  return {
    titles: (data ?? []).map((r) => String(r.title ?? '')),
    questions: (data ?? []).map((r) => String(r.question ?? '')),
  };
}

function pickAnswerMode(args: {
  multiHave: number;
  remainingSlots: number;
}): AnswerMode {
  const multiStillNeeded = MULTI_TARGET_TOTAL - args.multiHave;
  if (multiStillNeeded <= 0) return 'single';
  if (args.remainingSlots <= 0) return 'single';
  if (multiStillNeeded >= args.remainingSlots) return 'multi';
  return Math.random() < multiStillNeeded / args.remainingSlots
    ? 'multi'
    : 'single';
}

function buildGeneratePrompt(args: {
  certName: string;
  domain: DomainMeta;
  scenario: string;
  indexInDomain: number;
  answerMode: AnswerMode;
  avoidTitles: string[];
}): string {
  const modeRules =
    args.answerMode === 'multi'
      ? `- 複数選択（正解はちょうど2つ）
- 選択肢は5つ
- 問題文に「正しいものを2つ選べ」と明記する
- 2つの正解は相補的で、片方だけでは要件を満たさない設計にする`
      : `- 単一選択（正解はちょうど1つ）
- 選択肢は4つ
- ダブル正解にならないよう要件を明確にする`;

  const choiceSchema =
    args.answerMode === 'multi'
      ? `[
    { "value": "", "is_answer": true, "reason": "" },
    { "value": "", "is_answer": true, "reason": "" },
    { "value": "", "is_answer": false, "reason": "" },
    { "value": "", "is_answer": false, "reason": "" },
    { "value": "", "is_answer": false, "reason": "" }
  ]`
      : `[
    { "value": "", "is_answer": true, "reason": "" },
    { "value": "", "is_answer": false, "reason": "" },
    { "value": "", "is_answer": false, "reason": "" },
    { "value": "", "is_answer": false, "reason": "" }
  ]`;

  const avoidBlock =
    args.avoidTitles.length > 0
      ? `\n既存バンクに既にあるテーマ（これらと題材・構成が似た問題は禁止）:\n${args.avoidTitles
          .slice(0, 40)
          .map((t, i) => `${i + 1}. ${t}`)
          .join('\n')}\n`
      : '';

  return `あなたは AWS Certified Solutions Architect - Professional (SAP-C02) の問題作成者です。
公式ドメイン比率に沿ったオリジナルの練習問題を1問だけ作成してください。
公式過去問の複製は禁止。一般的な設計判断を問うシナリオ問題にします。

資格: ${args.certName}
ドメイン: ${args.domain.label} (${args.domain.key}, 公式比率 ${args.domain.weight}%)
シナリオ骨組み: ${args.scenario}
同一ドメイン内の通し番号: ${args.indexInDomain}
解答形式: ${args.answerMode === 'multi' ? '複数選択' : '単一選択'}
${avoidBlock}
要件パラメータ（どれかを主軸に含める。既存と被らない組み合わせにする）:
- コスト / 運用負荷 / 高可用性 / セキュリティ / 移行リスク / パフォーマンス / コンプライアンス のいずれか

ルール:
- 日本語
${modeRules}
- 各選択肢に reason（正解理由 or 不正解理由）を必ず付ける
- 非推奨の旧サービス名に依存しない（現行の主要サービスを使う）
- 既存問題との重複禁止（同じ企業状況の言い換え、同じ構成パターンの使い回し不可）
- タイトルは内容が分かる具体名（「練習問題」「模擬問題」「SAP-C02 #N」形式は禁止）
- 冒頭の定型文（「ある企業が…」「大規模なエンタープライズ企業が…」）を毎回同じにしない
- 制約条件（RPO/RTO、アカウント数、サービス組み合わせ、失敗時の要件など）を既存と差別化する

出力はJSONのみ:
{
  "title": "",
  "question": "",
  "explanation": "",
  "choices": ${choiceSchema}
}`;
}

function buildReviewPrompt(
  draft: QuestionDraft,
  domainLabel: string,
  answerMode: AnswerMode,
  avoidTitles: string[],
): string {
  const answerCheck =
    answerMode === 'multi'
      ? '1. 正解はちょうど2つか（過不足・ダブル判定の曖昧さがないか）'
      : '1. 正解は本当に1つだけか（ダブル正解がないか）';

  const avoidBlock =
    avoidTitles.length > 0
      ? `\n既存タイトル一覧（類似なら不合格）:\n${avoidTitles
          .slice(0, 40)
          .map((t) => `- ${t}`)
          .join('\n')}\n`
      : '';

  return `あなたは SAP-C02 問題の検品担当です。生成用とは別視点で査読してください。

ドメイン: ${domainLabel}
解答形式: ${answerMode === 'multi' ? '複数選択（正解2つ）' : '単一選択'}
候補問題:
${JSON.stringify(draft, null, 2)}
${avoidBlock}
チェック:
${answerCheck}
2. 不正解選択肢の reason が破綻していないか
3. 明らかに非推奨・時代遅れのサービス前提になっていないか
4. 問題文と正解がドメイン内容と概ね整合するか
5. 既存問題と題材・構成が実質重複していないか（言い換え含む）
6. タイトルが具体的か（練習問題番号形式でないか）
${answerMode === 'multi' ? '7. 問題文に「2つ選べ」系の指示があるか' : ''}

不合格なら pass=false と issues。修正可能なら revised に修正版を入れる。
合格なら pass=true、revised は null。

出力JSONのみ:
{
  "pass": true,
  "issues": [],
  "revised": null
}`;
}

function parseReview(raw: unknown): {
  pass: boolean;
  issues: string[];
  revised: QuestionDraft | null;
} {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const issues = Array.isArray(obj.issues)
    ? obj.issues.map((x) => String(x ?? '').trim()).filter(Boolean)
    : [];
  const pass = Boolean(obj.pass) && issues.length === 0;
  let revised: QuestionDraft | null = null;
  if (obj.revised && typeof obj.revised === 'object') {
    revised = normalizeDraft(obj.revised);
  }
  return { pass, issues, revised };
}

async function ensureDomainCategories(
  admin: AdminClient,
  certificationId: string,
): Promise<Record<DomainKey, string>> {
  const { data: existing, error } = await admin
    .from('certification_categories')
    .select('id, name, sort_order')
    .eq('certification_id', certificationId);

  if (error) throw new Error('カテゴリの取得に失敗しました');

  const byName = new Map<string, string>();
  let maxSort = 0;
  for (const row of existing ?? []) {
    byName.set(String(row.name), row.id as string);
    maxSort = Math.max(maxSort, Number(row.sort_order) || 0);
  }

  const map = {} as Record<DomainKey, string>;
  for (const domain of SAP_DOMAINS) {
    let id = byName.get(domain.categoryName);
    if (!id) {
      maxSort += 1;
      const { data: inserted, error: insertError } = await admin
        .from('certification_categories')
        .insert({
          certification_id: certificationId,
          name: domain.categoryName,
          sort_order: maxSort,
        })
        .select('id')
        .single();
      if (insertError || !inserted) {
        throw new Error('カテゴリの作成に失敗しました');
      }
      id = inserted.id as string;
      byName.set(domain.categoryName, id);
    }
    map[domain.key] = id;
  }
  return map;
}

async function backfillBankCategories(
  admin: AdminClient,
  certificationId: string,
  categoryByDomain: Record<DomainKey, string>,
): Promise<number> {
  const { data: rows, error } = await admin
    .from('examples')
    .select('id, domain')
    .eq('certification_id', certificationId)
    .is('user_id', null)
    .is('category_id', null);
  if (error) throw new Error('カテゴリ未設定のバンク問題の取得に失敗しました');

  let updated = 0;
  for (const row of rows ?? []) {
    const domain = row.domain as DomainKey | null;
    if (!domain || !(domain in categoryByDomain)) continue;
    const { error: updError } = await admin
      .from('examples')
      .update({ category_id: categoryByDomain[domain] })
      .eq('id', row.id);
    if (!updError) updated += 1;
  }
  return updated;
}

function buildProgress(counts: Record<DomainKey, number>) {
  const progress = SAP_DOMAINS.map((d) => ({
    domain: d.key,
    label: d.label,
    have: counts[d.key],
    need: d.fullCount,
    remaining: Math.max(0, d.fullCount - counts[d.key]),
  }));
  const domainHave = progress.reduce((s, p) => s + p.have, 0);
  const domainRemaining = progress.reduce((s, p) => s + p.remaining, 0);
  return {
    progress,
    domainHave,
    domainRemaining,
  };
}

type BankInventory = {
  counts: Record<DomainKey, number>;
  /** 共有バンクの実件数（domain の有無に依存しない） */
  totalHave: number;
  unknownDomain: number;
  progress: ReturnType<typeof buildProgress>['progress'];
  domainRemaining: number;
  totalRemaining: number;
};

async function loadBankInventory(
  admin: AdminClient,
  certificationId: string,
): Promise<BankInventory> {
  const { data: bankRows, error, count } = await admin
    .from('examples')
    .select('id, domain', { count: 'exact' })
    .eq('certification_id', certificationId)
    .is('user_id', null);
  if (error) throw new Error('共有バンクの取得に失敗しました');

  const counts: Record<DomainKey, number> = {
    organizational_complexity: 0,
    new_solutions: 0,
    continuous_improvement: 0,
    migration_modernization: 0,
  };
  let unknownDomain = 0;
  for (const row of bankRows ?? []) {
    const d = row.domain as DomainKey | null;
    if (d && d in counts) counts[d] += 1;
    else unknownDomain += 1;
  }

  // count が取れた場合はそれを正とする（ページング漏れ対策）
  const totalHave =
    typeof count === 'number' && count >= 0
      ? count
      : (bankRows ?? []).length;

  const { progress, domainRemaining } = buildProgress(counts);
  return {
    counts,
    totalHave,
    unknownDomain,
    progress,
    domainRemaining,
    totalRemaining: Math.max(0, TARGET_TOTAL - totalHave),
  };
}

/** @deprecated alias — 互換用 */
async function loadCounts(
  admin: AdminClient,
  certificationId: string,
): Promise<Record<DomainKey, number>> {
  const inventory = await loadBankInventory(admin, certificationId);
  return inventory.counts;
}

async function countAnswerTypes(
  admin: AdminClient,
  certificationId: string,
): Promise<{
  single: number;
  multi: number;
  singleIds: string[];
  multiIds: string[];
}> {
  const { data: bankRows, error } = await admin
    .from('examples')
    .select('id')
    .eq('certification_id', certificationId)
    .is('user_id', null);
  if (error) throw new Error('共有バンクの取得に失敗しました');

  const ids = (bankRows ?? []).map((r) => r.id as string);
  if (ids.length === 0) {
    return { single: 0, multi: 0, singleIds: [], multiIds: [] };
  }

  const correctCountByExample = new Map<string, number>();
  // in chunks to avoid URL limits
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data: answers, error: answerError } = await admin
      .from('select_answer')
      .select('example_id, is_answer')
      .in('example_id', chunk)
      .eq('is_answer', true);
    if (answerError) throw new Error('選択肢集計に失敗しました');
    for (const row of answers ?? []) {
      const id = row.example_id as string;
      correctCountByExample.set(id, (correctCountByExample.get(id) ?? 0) + 1);
    }
  }

  const singleIds: string[] = [];
  const multiIds: string[] = [];
  for (const id of ids) {
    if ((correctCountByExample.get(id) ?? 0) >= 2) multiIds.push(id);
    else singleIds.push(id);
  }
  return {
    single: singleIds.length,
    multi: multiIds.length,
    singleIds,
    multiIds,
  };
}

function answerTypeSummary(single: number, multi: number) {
  const total = single + multi;
  const multiRatio = total > 0 ? multi / total : 0;
  const inRange =
    total > 0 &&
    multiRatio >= MULTI_MIN_RATIO &&
    multiRatio <= MULTI_MAX_RATIO;
  return {
    single,
    multi,
    total,
    multiRatio,
    multiTarget: MULTI_TARGET_TOTAL,
    multiMinRatio: MULTI_MIN_RATIO,
    multiMaxRatio: MULTI_MAX_RATIO,
    inTargetRange: inRange,
  };
}

/** 複数選択が不足しているとき、単一選択を削除して枠を空ける */
async function rebalanceForMulti(
  admin: AdminClient,
  certificationId: string,
): Promise<{ deleted: number; multiHave: number; singleHave: number }> {
  const types = await countAnswerTypes(admin, certificationId);
  const multiNeed = Math.max(0, MULTI_TARGET_TOTAL - types.multi);
  if (multiNeed <= 0 || types.singleIds.length === 0) {
    return {
      deleted: 0,
      multiHave: types.multi,
      singleHave: types.single,
    };
  }

  // ドメイン偏りを抑えるため、単一選択をドメイン別に分散削除
  const { data: singleRows, error: singleMetaError } = await admin
    .from('examples')
    .select('id, domain')
    .in('id', types.singleIds);
  if (singleMetaError) {
    throw new Error('単一選択問題の取得に失敗しました');
  }

  const byDomain = new Map<string, string[]>();
  const noDomain: string[] = [];
  for (const row of singleRows ?? []) {
    const id = row.id as string;
    const d = row.domain as string | null;
    if (d && SAP_DOMAINS.some((x) => x.key === d)) {
      const list = byDomain.get(d) ?? [];
      list.push(id);
      byDomain.set(d, list);
    } else {
      noDomain.push(id);
    }
  }

  const toDelete: string[] = [];
  // ドメイン未設定を優先削除
  while (toDelete.length < multiNeed && noDomain.length > 0) {
    toDelete.push(noDomain.shift()!);
  }
  while (toDelete.length < multiNeed) {
    // 残数が最多のドメインから1問ずつ
    let bestKey: string | null = null;
    let bestLen = -1;
    for (const [key, list] of byDomain) {
      if (list.length > bestLen) {
        bestLen = list.length;
        bestKey = key;
      }
    }
    if (!bestKey || bestLen <= 0) break;
    const list = byDomain.get(bestKey)!;
    toDelete.push(list.shift()!);
  }

  if (toDelete.length === 0) {
    return {
      deleted: 0,
      multiHave: types.multi,
      singleHave: types.single,
    };
  }

  await admin.from('user_example_library').delete().in('example_id', toDelete);
  await admin.from('select_answer').delete().in('example_id', toDelete);
  const { error } = await admin.from('examples').delete().in('id', toDelete);
  if (error) throw new Error('複数選択用の枠確保（単一削除）に失敗しました');

  await admin
    .from('certifications')
    .update({
      exam_bank_status: 'generating',
      exam_bank_message: `複数選択の比率調整のため ${toDelete.length} 問を削除しました。再生成で補充してください。`,
    })
    .eq('id', certificationId);

  return {
    deleted: toDelete.length,
    multiHave: types.multi,
    singleHave: types.single - toDelete.length,
  };
}

async function resetBank(
  admin: AdminClient,
  certificationId: string,
): Promise<number> {
  const { data: rows, error } = await admin
    .from('examples')
    .select('id')
    .eq('certification_id', certificationId)
    .is('user_id', null);
  if (error) throw new Error('共有バンクの取得に失敗しました');

  const ids = (rows ?? []).map((r) => r.id as string);
  if (ids.length === 0) {
    await admin
      .from('certifications')
      .update({
        exam_bank_status: 'none',
        exam_bank_message: null,
      })
      .eq('id', certificationId);
    return 0;
  }

  await admin.from('user_example_library').delete().in('example_id', ids);
  await admin.from('select_answer').delete().in('example_id', ids);
  const { error: delError } = await admin
    .from('examples')
    .delete()
    .in('id', ids);
  if (delError) throw new Error('共有バンクの削除に失敗しました');

  await admin
    .from('certifications')
    .update({
      exam_bank_status: 'none',
      exam_bank_message: '共有バンクをクリアしました',
    })
    .eq('id', certificationId);

  return ids.length;
}

async function createOneBankQuestion(args: {
  admin: AdminClient;
  geminiKey: string;
  geminiModel: string;
  certName: string;
  certificationId: string;
  domainMeta: DomainMeta;
  categoryId: string;
  indexInDomain: number;
  totalHave: number;
  answerMode: AnswerMode;
  existing: ExistingBankFingerprints;
}): Promise<{ exampleId: string; answerMode: AnswerMode }> {
  const answerMode = args.answerMode;
  const avoidTitles = args.existing.titles.filter((t) => t.trim().length > 0);
  const maxAttempts = 5;
  let lastFailMessage = '生成に失敗しました';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const scenario =
      SCENARIO_TEMPLATES[
        (args.totalHave * 3 +
          args.indexInDomain * 5 +
          args.domainMeta.fullCount +
          attempt * 11) %
          SCENARIO_TEMPLATES.length
      ]!;

    const buildPrompt = (extra = '') =>
      buildGeneratePrompt({
        certName: args.certName,
        domain: args.domainMeta,
        scenario,
        indexInDomain: args.indexInDomain,
        answerMode,
        avoidTitles,
      }) + extra;

    try {
      let draft = normalizeDraft(
        await callGeminiJson(
          args.geminiKey,
          args.geminiModel,
          buildPrompt(
            attempt > 1
              ? `\n\n再試行 ${attempt}/${maxAttempts}: 既存問題と重複しない、別制約・別構成の新規シナリオにしてください。`
              : '',
          ),
          0.55 + attempt * 0.08,
        ),
      );

      let localIssues = localValidate(draft, answerMode);
      let dupIssue = findDuplicateAgainstExisting(draft, args.existing);
      if (dupIssue) localIssues = [...localIssues, dupIssue];

      // 同一試行内で1回だけ作り直し
      if (localIssues.length > 0) {
        draft = normalizeDraft(
          await callGeminiJson(
            args.geminiKey,
            args.geminiModel,
            buildPrompt(
              `\n\n前回不合格理由: ${localIssues.join(' / ')}\n必ず別の題材・別の制約条件で作り直してください。`,
            ),
            0.5 + attempt * 0.05,
          ),
        );
        localIssues = localValidate(draft, answerMode);
        dupIssue = findDuplicateAgainstExisting(draft, args.existing);
        if (dupIssue) localIssues = [...localIssues, dupIssue];
      }

      const review = parseReview(
        await callGeminiJson(
          args.geminiKey,
          args.geminiModel,
          buildReviewPrompt(
            draft,
            args.domainMeta.label,
            answerMode,
            avoidTitles,
          ),
          0.1,
        ),
      );

      if (!review.pass && review.revised) {
        draft = review.revised;
        localIssues = localValidate(draft, answerMode);
      } else if (review.pass) {
        localIssues = localValidate(draft, answerMode);
      }

      dupIssue = findDuplicateAgainstExisting(draft, args.existing);
      if (dupIssue) localIssues = [...localIssues, dupIssue];

      if (localIssues.length > 0 || (!review.pass && !review.revised)) {
        const issues =
          localIssues.length > 0
            ? localIssues
            : review.issues.length
              ? review.issues
              : ['検品不合格'];
        lastFailMessage = `検品不合格: ${issues.join(' / ')}`;
        console.warn(
          `[generate-exam-bank] attempt ${attempt}/${maxAttempts}`,
          lastFailMessage,
        );
        continue;
      }

      const { data: inserted, error: insertError } = await args.admin
        .from('examples')
        .insert({
          certification_id: args.certificationId,
          user_id: null,
          domain: args.domainMeta.key,
          title: draft.title,
          question: draft.question,
          answer: '',
          explanation: draft.explanation,
          category_id: args.categoryId,
        })
        .select('id')
        .single();

      if (insertError || !inserted) {
        throw new Error('例題の保存に失敗しました');
      }

      const exampleId = inserted.id as string;
      const { error: choiceError } = await args.admin
        .from('select_answer')
        .insert(
          draft.choices.map((c) => ({
            example_id: exampleId,
            value: c.value,
            is_answer: c.is_answer,
            reason: c.reason,
          })),
        );

      if (choiceError) {
        await args.admin.from('examples').delete().eq('id', exampleId);
        throw new Error('選択肢の保存に失敗しました');
      }

      args.existing.titles.push(draft.title);
      args.existing.questions.push(draft.question);
      return { exampleId, answerMode };
    } catch (err) {
      // DB保存失敗などはリトライ対象外
      const message =
        err instanceof Error ? err.message : '生成に失敗しました';
      if (
        message.includes('例題の保存に失敗') ||
        message.includes('選択肢の保存に失敗')
      ) {
        throw err;
      }
      lastFailMessage = message;
      console.warn(
        `[generate-exam-bank] attempt ${attempt}/${maxAttempts} error`,
        message,
      );
    }
  }

  throw new Error(lastFailMessage);
}

function isRetryableGenerationError(message: string): boolean {
  return (
    message.includes('類似') ||
    message.includes('重複') ||
    message.includes('検品不合格') ||
    message.includes('タイトルが') ||
    message.includes('問題文が')
  );
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
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!geminiKey || !supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return jsonResponse(
        { ok: false, error: 'サーバー設定が不足しています' },
        500,
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ ok: false, error: '認証が必要です' }, 401);
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ ok: false, error: '認証が必要です' }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as {
      certification_id?: string;
      mode?: 'status' | 'reset' | 'generate' | 'pilot' | 'rebalance_multi';
    };
    const certificationId = String(body.certification_id ?? '').trim();
    const rawMode = body.mode ?? 'generate';
    const mode =
      rawMode === 'status' ||
      rawMode === 'reset' ||
      rawMode === 'pilot' ||
      rawMode === 'rebalance_multi'
        ? rawMode === 'pilot'
          ? 'generate'
          : rawMode
        : 'generate';

    if (!certificationId) {
      return jsonResponse(
        { ok: false, error: 'certification_id が必要です' },
        400,
      );
    }

    const { data: owned, error: ownedError } = await userClient
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

    const { data: cert, error: certError } = await admin
      .from('certifications')
      .select('id, name, exam_code, exam_bank_status, exam_bank_message')
      .eq('id', certificationId)
      .single();

    if (certError || !cert) {
      return jsonResponse({ ok: false, error: '資格が見つかりません' }, 404);
    }

    if (
      !isSapCertification(cert.name as string, cert.exam_code as string | null)
    ) {
      return jsonResponse(
        {
          ok: false,
          error:
            '共有バンク生成は AWS Solutions Architect Professional (SAP-C02) 向けです。',
        },
        400,
      );
    }

    if (!cert.exam_code) {
      await admin
        .from('certifications')
        .update({ exam_code: 'SAP-C02' })
        .eq('id', certificationId);
    }

    if (mode === 'reset') {
      const deleted = await resetBank(admin, certificationId);
      return jsonResponse({
        ok: true,
        mode: 'reset',
        deleted,
        status: 'none',
        totalHave: 0,
        totalRemaining: TARGET_TOTAL,
        complete: false,
        created: 0,
        answerTypes: answerTypeSummary(0, 0),
        progress: SAP_DOMAINS.map((d) => ({
          domain: d.key,
          label: d.label,
          have: 0,
          need: d.fullCount,
          remaining: d.fullCount,
        })),
      });
    }

    if (mode === 'rebalance_multi') {
      const result = await rebalanceForMulti(admin, certificationId);
      const inventory = await loadBankInventory(admin, certificationId);
      const types = await countAnswerTypes(admin, certificationId);
      return jsonResponse({
        ok: true,
        mode: 'rebalance_multi',
        deleted: result.deleted,
        totalHave: inventory.totalHave,
        totalRemaining: inventory.totalRemaining,
        targetTotal: TARGET_TOTAL,
        progress: inventory.progress,
        answerTypes: answerTypeSummary(types.single, types.multi),
        status: inventory.totalRemaining > 0 ? 'generating' : 'ready',
        message:
          result.deleted > 0
            ? `複数選択の枠を確保するため単一選択を ${result.deleted} 問削除しました（現在 ${inventory.totalHave}/${TARGET_TOTAL}）。生成を再開してください。`
            : '複数選択の比率は目標範囲です（削除なし）。',
      });
    }

    const categoryByDomain = await ensureDomainCategories(
      admin,
      certificationId,
    );
    const backfilled = await backfillBankCategories(
      admin,
      certificationId,
      categoryByDomain,
    );

    let inventory = await loadBankInventory(admin, certificationId);
    let typeCounts = await countAnswerTypes(admin, certificationId);
    let answerTypes = answerTypeSummary(typeCounts.single, typeCounts.multi);

    if (mode === 'status') {
      return jsonResponse({
        ok: true,
        mode: 'status',
        status: cert.exam_bank_status,
        message: cert.exam_bank_message,
        totalHave: inventory.totalHave,
        totalRemaining: inventory.totalRemaining,
        targetTotal: TARGET_TOTAL,
        batchSize: BATCH_SIZE,
        progress: inventory.progress,
        answerTypes,
        unknownDomain: inventory.unknownDomain,
        categoriesBackfilled: backfilled,
      });
    }

    // generate
    if (inventory.totalRemaining <= 0) {
      await admin
        .from('certifications')
        .update({
          exam_bank_status: 'ready',
          exam_bank_message: `共有バンク ${inventory.totalHave} 問が利用可能です（単一 ${answerTypes.single} / 複数 ${answerTypes.multi}）`,
        })
        .eq('id', certificationId);
      return jsonResponse({
        ok: true,
        complete: true,
        created: 0,
        totalHave: inventory.totalHave,
        totalRemaining: 0,
        targetTotal: TARGET_TOTAL,
        progress: inventory.progress,
        answerTypes,
        status: 'ready',
      });
    }

    await admin
      .from('certifications')
      .update({
        exam_bank_status: 'generating',
        exam_bank_message: `共有バンク生成中（${inventory.totalHave}/${TARGET_TOTAL}）`,
      })
      .eq('id', certificationId);

    let created = 0;
    let lastError: string | null = null;
    const createdIds: string[] = [];
    let multiHave = answerTypes.multi;
    let existingFingerprints = await loadExistingFingerprints(
      admin,
      certificationId,
    );
    let consecutiveRetryableFailures = 0;

    while (created < BATCH_SIZE) {
      inventory = await loadBankInventory(admin, certificationId);
      if (inventory.totalRemaining <= 0) break;

      // ドメイン不足があれば優先。なければ（件数不足のみ）最少ドメインへ補充
      let next = inventory.progress.find((p) => p.remaining > 0);
      if (!next) {
        next = [...inventory.progress].sort((a, b) => a.have - b.have)[0];
      }
      if (!next) break;
      const domainMeta = SAP_DOMAINS.find((d) => d.key === next.domain)!;
      const answerMode = pickAnswerMode({
        multiHave,
        remainingSlots: inventory.totalRemaining,
      });

      try {
        const { exampleId } = await createOneBankQuestion({
          admin,
          geminiKey,
          geminiModel,
          certName: cert.name as string,
          certificationId,
          domainMeta,
          categoryId: categoryByDomain[domainMeta.key],
          indexInDomain: next.have + 1,
          totalHave: inventory.totalHave,
          answerMode,
          existing: existingFingerprints,
        });
        created += 1;
        createdIds.push(exampleId);
        consecutiveRetryableFailures = 0;
        lastError = null;
        if (answerMode === 'multi') multiHave += 1;
      } catch (err) {
        lastError =
          err instanceof Error ? err.message : '生成に失敗しました';
        console.error('[generate-exam-bank] one question', err);
        // 重複・検品系はバッチを止めず次の生成枠へ進む（連続失敗時のみ打ち切り）
        if (
          isRetryableGenerationError(lastError) &&
          consecutiveRetryableFailures < 2
        ) {
          consecutiveRetryableFailures += 1;
          continue;
        }
        break;
      }
    }

    inventory = await loadBankInventory(admin, certificationId);
    typeCounts = await countAnswerTypes(admin, certificationId);
    answerTypes = answerTypeSummary(typeCounts.single, typeCounts.multi);
    const complete = inventory.totalRemaining <= 0;

    if (created === 0 && lastError) {
      await admin
        .from('certifications')
        .update({
          exam_bank_status: 'failed',
          exam_bank_message: lastError,
        })
        .eq('id', certificationId);
      return jsonResponse(
        {
          ok: false,
          error: lastError,
          created: 0,
          totalHave: inventory.totalHave,
          totalRemaining: inventory.totalRemaining,
          targetTotal: TARGET_TOTAL,
          progress: inventory.progress,
          answerTypes,
        },
        422,
      );
    }

    await admin
      .from('certifications')
      .update({
        exam_bank_status: complete ? 'ready' : 'generating',
        exam_bank_message: complete
          ? `共有バンク ${inventory.totalHave} 問が利用可能です（単一 ${answerTypes.single} / 複数 ${answerTypes.multi}）`
          : `共有バンク生成中（${inventory.totalHave}/${TARGET_TOTAL}）` +
            (lastError ? ` / 直近エラー: ${lastError}` : ''),
      })
      .eq('id', certificationId);

    return jsonResponse({
      ok: true,
      complete,
      created,
      exampleIds: createdIds,
      totalHave: inventory.totalHave,
      totalRemaining: inventory.totalRemaining,
      targetTotal: TARGET_TOTAL,
      batchSize: BATCH_SIZE,
      progress: inventory.progress,
      answerTypes,
      status: complete ? 'ready' : 'generating',
      warning: lastError,
    });
  } catch (error) {
    console.error('[generate-exam-bank] unexpected', error);
    return jsonResponse(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : '予期しないエラーが発生しました',
      },
      500,
    );
  }
});
