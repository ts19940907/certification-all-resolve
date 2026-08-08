export type UnderstandingGrade = 'A' | 'B' | 'C' | 'D';

export type KeywordReviewResult = {
  keyword: string;
  explanation: string;
  grade: UnderstandingGrade;
  reason: string;
  good_points: string;
  bad_points: string;
};
