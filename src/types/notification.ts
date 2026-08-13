export type UserNotificationKind = 'example_report_resolved';

export type UserNotification = {
  id: string;
  userId: string;
  kind: UserNotificationKind;
  title: string;
  body: string;
  exampleId: string | null;
  exampleTitle: string;
  certificationId: string | null;
  reportId: string | null;
  readAt: string | null;
  createdAt: string;
  createdAtLabel: string;
  isUnread: boolean;
};
