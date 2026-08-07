export type Certification = {
  id: string;
  name: string;
  /** UI用。本番では中間テーブルの is_archive に相当 */
  isArchive: boolean;
};
