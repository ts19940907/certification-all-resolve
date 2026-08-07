import type { DiagramChoiceItem, ExampleDiagram } from '../types/diagram';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function listHtml(items: string[]): string {
  if (items.length === 0) {
    return '<p class="muted">（記載なし）</p>';
  }
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function verdictLabel(verdict: DiagramChoiceItem['verdict']): string {
  switch (verdict) {
    case 'correct':
      return '正解';
    case 'incorrect':
      return '誤り';
    default:
      return '参考';
  }
}

function choiceCards(choices: DiagramChoiceItem[]): string {
  if (choices.length === 0) {
    return '<p class="muted">記述式のため、選択肢の図解はありません。</p>';
  }
  return `<div class="choice-grid">${choices
    .map((choice) => {
      const cls =
        choice.verdict === 'correct'
          ? 'choice-card correct'
          : choice.verdict === 'incorrect'
            ? 'choice-card incorrect'
            : 'choice-card';
      return `<div class="${cls}">
  <div class="choice-head">
    <span class="choice-label">${escapeHtml(choice.label)}</span>
    <span class="choice-badge">${verdictLabel(choice.verdict)}</span>
  </div>
  <p class="choice-gist">${escapeHtml(choice.gist || '（要約なし）')}</p>
  ${
    choice.note
      ? `<p class="choice-note">${escapeHtml(choice.note)}</p>`
      : ''
  }
</div>`;
    })
    .join('')}</div>`;
}

function stepFlow(steps: string[]): string {
  if (steps.length === 0) {
    return '<p class="muted">（記載なし）</p>';
  }
  return `<div class="steps">${steps
    .map(
      (step, index) => `<div class="step">
  <div class="step-num">${index + 1}</div>
  <div class="step-body">${escapeHtml(step)}</div>
</div>${index < steps.length - 1 ? '<div class="step-arrow">↓</div>' : ''}`,
    )
    .join('')}</div>`;
}

export function buildDiagramHtml(diagram: ExampleDiagram): string {
  const ask = diagram.question_ask;
  const exp = diagram.explanation;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(diagram.title)} — 図解</title>
  <style>
    :root {
      --ink: #102A43;
      --ink-soft: #334E68;
      --muted: #627D98;
      --line: #D9E2EC;
      --paper: #FFFFFF;
      --mist: #F0F4F8;
      --accent: #0E7C7B;
      --accent-soft: #E6F4F3;
      --accent-deep: #095E5D;
      --wrong: #E4572E;
      --wrong-soft: #FFF1EC;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 28px;
      font-family: "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif;
      color: var(--ink);
      background: var(--paper);
      font-size: 13px;
      line-height: 1.65;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 22px;
      color: var(--accent-deep);
    }
    .lead {
      margin: 0 0 22px;
      color: var(--ink-soft);
      font-size: 12px;
    }
    .question-box {
      border: 1px solid var(--line);
      background: var(--mist);
      border-radius: 12px;
      padding: 14px 16px;
      margin-bottom: 22px;
    }
    .question-box .label {
      font-weight: 700;
      font-size: 11px;
      color: var(--muted);
      margin-bottom: 6px;
    }
    .section {
      break-inside: avoid;
      page-break-inside: avoid;
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 18px;
      margin-bottom: 18px;
      background: var(--paper);
    }
    .section-head {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
    }
    .section-num {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--accent);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 13px;
    }
    .section-title {
      margin: 0;
      font-size: 16px;
    }
    .summary {
      background: var(--accent-soft);
      border-radius: 10px;
      padding: 12px 14px;
      margin-bottom: 12px;
      font-weight: 600;
      color: var(--accent-deep);
    }
    .trap {
      background: var(--wrong-soft);
      border-left: 4px solid var(--wrong);
      border-radius: 8px;
      padding: 10px 12px;
      margin-top: 10px;
      color: var(--ink-soft);
    }
    .muted { color: var(--muted); margin: 0; }
    ul { margin: 8px 0 0; padding-left: 1.2em; }
    li { margin: 4px 0; }
    .subhead {
      margin: 14px 0 8px;
      font-size: 12px;
      font-weight: 700;
      color: var(--ink-soft);
    }
    .choice-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .choice-card {
      border: 1.5px solid var(--line);
      border-radius: 12px;
      padding: 12px;
      background: var(--mist);
    }
    .choice-card.correct {
      border-color: var(--accent);
      background: var(--accent-soft);
    }
    .choice-card.incorrect {
      border-color: #f0b8a8;
      background: var(--wrong-soft);
    }
    .choice-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .choice-label {
      font-weight: 700;
      font-size: 15px;
    }
    .choice-badge {
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 999px;
      background: white;
      color: var(--ink-soft);
      border: 1px solid var(--line);
    }
    .choice-card.correct .choice-badge {
      background: var(--accent);
      color: white;
      border-color: var(--accent);
    }
    .choice-card.incorrect .choice-badge {
      background: var(--wrong);
      color: white;
      border-color: var(--wrong);
    }
    .choice-gist { margin: 0 0 6px; }
    .choice-note { margin: 0; font-size: 12px; color: var(--ink-soft); }
    .steps { margin-top: 8px; }
    .step {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      background: var(--mist);
      border-radius: 10px;
      padding: 10px 12px;
    }
    .step-num {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: var(--accent);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      flex-shrink: 0;
      font-size: 12px;
    }
    .step-body { flex: 1; }
    .step-arrow {
      text-align: center;
      color: var(--accent);
      font-weight: 700;
      margin: 4px 0;
    }
    .footer {
      margin-top: 8px;
      font-size: 11px;
      color: var(--muted);
      text-align: right;
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(diagram.title)}</h1>
  <p class="lead">例題図解（問題の問い → 選択肢の意味 → 正解の理由）</p>

  <div class="question-box">
    <div class="label">問題文</div>
    <div>${escapeHtml(diagram.question)}</div>
  </div>

  <section class="section">
    <div class="section-head">
      <div class="section-num">1</div>
      <h2 class="section-title">問題文で何を問うているか</h2>
    </div>
    <div class="summary">${escapeHtml(ask.summary || '（要約なし）')}</div>
    <div class="subhead">着目点</div>
    ${listHtml(ask.points)}
    ${
      ask.trap
        ? `<div class="trap"><strong>ひっかけ・迷いやすい点:</strong> ${escapeHtml(ask.trap)}</div>`
        : ''
    }
  </section>

  <section class="section">
    <div class="section-head">
      <div class="section-num">2</div>
      <h2 class="section-title">各選択肢が何を言っているか</h2>
    </div>
    ${choiceCards(diagram.choices)}
  </section>

  <section class="section">
    <div class="section-head">
      <div class="section-num">3</div>
      <h2 class="section-title">解説・なぜその答えになるか</h2>
    </div>
    <div class="summary">${escapeHtml(exp.conclusion || '（結論なし）')}</div>
    <div class="subhead">正解になる理由</div>
    ${listHtml(exp.why)}
    <div class="subhead">考え方の流れ</div>
    ${stepFlow(exp.steps)}
  </section>

  <p class="footer">CertResolve 例題図解</p>
</body>
</html>`;
}

export function diagramPdfFilename(title: string): string {
  const safe = title
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 40);
  return `図解_${safe || '例題'}.pdf`;
}

/** Web / Electron 向けに PDF をダウンロード */
export async function downloadDiagramPdf(diagram: ExampleDiagram): Promise<void> {
  if (typeof document === 'undefined') {
    throw new Error('PDFダウンロードはWeb／デスクトップ版でのみ利用できます');
  }

  const html2pdfModule = await import('html2pdf.js');
  const html2pdf = html2pdfModule.default;
  const html = buildDiagramHtml(diagram);

  const container = document.createElement('div');
  container.innerHTML = html;
  // html2pdf は要素内の body 相当をレンダリングする
  const source = container.querySelector('body') ?? container;

  await html2pdf()
    .set({
      margin: [10, 10, 10, 10],
      filename: diagramPdfFilename(diagram.title),
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .from(source)
    .save();
}
