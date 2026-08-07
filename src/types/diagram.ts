export type DiagramChoiceItem = {
  label: string;
  gist: string;
  verdict: 'correct' | 'incorrect' | 'neutral';
  note: string;
};

export type ExampleDiagram = {
  title: string;
  question: string;
  question_ask: {
    summary: string;
    points: string[];
    trap: string;
  };
  choices: DiagramChoiceItem[];
  explanation: {
    conclusion: string;
    why: string[];
    steps: string[];
  };
};
