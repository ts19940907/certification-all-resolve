export type ReportTarget =
  | 'question'
  | 'choices'
  | 'explanation'
  | 'other';

export type ReportStatus = 'open' | 'resolved';

export type ExampleContentReport = {
  id: string;
  exampleId: string;
  exampleTitle: string;
  certificationId: string | null;
  certificationName: string;
  reporterUserId: string;
  target: ReportTarget;
  message: string;
  status: ReportStatus;
  adminResponse: string | null;
  resolvedAt: string | null;
  createdAt: string;
  createdAtLabel: string;
};

export function reportTargetLabel(target: ReportTarget): string {
  switch (target) {
    case 'question':
      return '問題文';
    case 'choices':
      return '選択肢・回答';
    case 'explanation':
      return '解説';
    case 'other':
      return 'その他';
  }
}
