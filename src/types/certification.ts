export type Certification = {
  /** certifications.id */
  id: string;
  name: string;
  isArchive: boolean;
  /** user_certifications.id（アーカイブ更新用） */
  userCertificationId: string;
  /** ビットフラグ 1=単一 2=複数 4=記述 */
  questionFormat: number;
  choiceMin: number | null;
  choiceMax: number | null;
  answerMax: number | null;
  /** 本番試験の出題数。試験問題バンク目標は ×2 */
  examQuestionCount: number | null;
};
