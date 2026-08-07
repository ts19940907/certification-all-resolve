/** certifications.question_format ビットフラグ */
export const QUESTION_FORMAT = {
  SINGLE_CHOICE: 1,
  MULTIPLE_CHOICE: 2,
  DESCRIPTIVE: 4,
} as const;

export type QuestionFormatBit =
  | typeof QUESTION_FORMAT.SINGLE_CHOICE
  | typeof QUESTION_FORMAT.MULTIPLE_CHOICE
  | typeof QUESTION_FORMAT.DESCRIPTIVE;

export type ConditionedFormatChoice = 'auto' | QuestionFormatBit;

export function listEnabledFormats(flags: number): QuestionFormatBit[] {
  const list: QuestionFormatBit[] = [];
  if (flags & QUESTION_FORMAT.SINGLE_CHOICE) {
    list.push(QUESTION_FORMAT.SINGLE_CHOICE);
  }
  if (flags & QUESTION_FORMAT.MULTIPLE_CHOICE) {
    list.push(QUESTION_FORMAT.MULTIPLE_CHOICE);
  }
  if (flags & QUESTION_FORMAT.DESCRIPTIVE) {
    list.push(QUESTION_FORMAT.DESCRIPTIVE);
  }
  return list;
}

export function questionFormatLabel(bit: QuestionFormatBit): string {
  switch (bit) {
    case QUESTION_FORMAT.SINGLE_CHOICE:
      return '単一選択';
    case QUESTION_FORMAT.MULTIPLE_CHOICE:
      return '複数選択';
    case QUESTION_FORMAT.DESCRIPTIVE:
      return '記述';
  }
}

export type ExampleSummary = {
  id: string;
  title: string;
};

export type SelectAnswer = {
  id: string;
  value: string;
  isAnswer: boolean;
  reason: string;
};

export type ExampleDetail = {
  id: string;
  title: string;
  question: string;
  answer: string;
  explanation: string;
  choices: SelectAnswer[];
};

/** answer が空なら選択式、否则記述式 */
export function isSelectExample(example: Pick<ExampleDetail, 'answer'>) {
  return example.answer.trim().length === 0;
}
