export type CertificationCategory = {
  id: string;
  certificationId: string;
  name: string;
  sortOrder: number;
};

export type CertificationKeyword = {
  id: string;
  certificationId: string;
  name: string;
  sortOrder: number;
};

export type AnalysisPeriod = 'all' | 'month' | 'week';

export type CategoryUnderstanding = {
  categoryId: string;
  name: string;
  correctCount: number;
  answeredCount: number;
  /** 0-100。未計測は null */
  rate: number | null;
};

export type KeywordProgress = {
  explainedCount: number;
  totalCount: number;
  rate: number | null;
  explainedNames: string[];
};

export type AnalysisSnapshot = {
  period: AnalysisPeriod | 'session';
  periodLabel: string;
  categories: CategoryUnderstanding[];
  keywordProgress: KeywordProgress;
};
