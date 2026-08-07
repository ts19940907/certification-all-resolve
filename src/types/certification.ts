export type Certification = {
  /** certifications.id */
  id: string;
  name: string;
  isArchive: boolean;
  /** user_certifications.id（アーカイブ更新用） */
  userCertificationId: string;
};
