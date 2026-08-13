export type SrsCardKind = 'keyword' | 'example';

/** again=今すぐ, hard=難しい, good=普通, easy=簡単 */
export type SrsRating = 'again' | 'hard' | 'good' | 'easy';

export type SrsCard = {
  id: string;
  userId: string;
  certificationId: string;
  kind: SrsCardKind;
  keywordText: string | null;
  keywordBack: string;
  exampleId: string | null;
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  dueOn: string;
  lastRating: SrsRating | null;
};

export type SrsCardState = {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  dueOn: string;
};

export const SRS_SESSION_LIMIT = 20;

export function srsRatingLabel(rating: SrsRating): string {
  switch (rating) {
    case 'again':
      return '今すぐ';
    case 'hard':
      return '難しい';
    case 'good':
      return '普通';
    case 'easy':
      return '簡単';
  }
}
