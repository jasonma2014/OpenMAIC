export class LessonCraftError extends Error {
  constructor(readonly reason: 'brief' | 'forbidden' | 'segment') {
    super(reason);
    this.name = 'LessonCraftError';
  }
}

export interface LessonBrief {
  grade: string;
  textbook: string;
  periods: string;
  objectives: string;
  baseline: string;
}

const SHORTCUTS = {
  simpler: '讲简单一点',
  'life-example': '换个生活例子',
  'add-exercise': '增加一道练习',
} as const;

export type RevisionShortcut = keyof typeof SHORTCUTS;
export type ExerciseType = 'order' | 'match' | 'classify' | 'choice';
export type KnowledgeKind = 'procedure' | 'vocabulary' | 'distinction' | 'fact';

function required(value: string | undefined, reason: LessonCraftError['reason'] = 'brief'): string {
  const text = value?.trim() ?? '';
  if (!text) throw new LessonCraftError(reason);
  return text;
}

export function assertLessonBrief(input: Partial<LessonBrief> | undefined): LessonBrief {
  return {
    grade: required(input?.grade),
    textbook: input?.textbook?.trim() ?? '',
    periods: input?.periods?.trim() ?? '',
    objectives: required(input?.objectives),
    baseline: input?.baseline?.trim() ?? '',
  };
}

export function composeLessonRequirement(brief: LessonBrief, topic: string): string {
  return [
    `年级：${brief.grade}`,
    brief.textbook ? `教材：${brief.textbook}` : '',
    brief.periods ? `课时：${brief.periods}` : '',
    `教学目标：${brief.objectives}`,
    brief.baseline ? `学生基础：${brief.baseline}` : '',
    `课题：${topic.trim()}`,
    '练习题型：实验步骤用排序，词义用配对，概念辨析用分类，一个明确答案用选择题。',
  ]
    .filter(Boolean)
    .join('\n');
}

export function applyRevisionShortcut(input: {
  role: 'teacher' | 'org_admin' | 'student';
  segments: Array<{ id: string; text: string }>;
  selectedId: string;
  shortcut: RevisionShortcut;
}): Array<{ id: string; text: string; instruction?: string }> {
  if (input.role === 'student') throw new LessonCraftError('forbidden');
  if (!input.segments.some((segment) => segment.id === input.selectedId)) {
    throw new LessonCraftError('segment');
  }
  return input.segments.map((segment) =>
    segment.id === input.selectedId
      ? { ...segment, instruction: SHORTCUTS[input.shortcut] }
      : { ...segment },
  );
}

export function masteryFromAnswers(
  answers: Array<{ studentId: string; studentName: string; point: string; correct: boolean }>,
): {
  unmastered: string[];
  studentsNeedingHelp: Array<{ studentId: string; studentName: string; points: string[] }>;
} {
  const unmastered: string[] = [];
  const byStudent = new Map<string, { studentName: string; points: string[] }>();
  for (const answer of answers) {
    if (answer.correct) continue;
    if (!unmastered.includes(answer.point)) unmastered.push(answer.point);
    const student = byStudent.get(answer.studentId) ?? {
      studentName: answer.studentName,
      points: [],
    };
    if (!student.points.includes(answer.point)) student.points.push(answer.point);
    byStudent.set(answer.studentId, student);
  }
  return {
    unmastered,
    studentsNeedingHelp: [...byStudent.entries()].map(([studentId, student]) => ({
      studentId,
      studentName: student.studentName,
      points: student.points,
    })),
  };
}

export function exerciseTypeFor(kind: KnowledgeKind): ExerciseType {
  if (kind === 'procedure') return 'order';
  if (kind === 'vocabulary') return 'match';
  if (kind === 'distinction') return 'classify';
  return 'choice';
}

export function applyExerciseOverride<T extends { id: string; type: ExerciseType }>(
  questions: T[],
  questionId: string,
  type: ExerciseType,
): T[] {
  return questions.map((question) =>
    question.id === questionId ? { ...question, type } : question,
  );
}

export function reviewOpenAnswer(input: {
  lessonId: string;
  correct: boolean;
  covered: string[];
  missed: string[];
  similarPrompt: string;
}): {
  lessonId: string;
  comment: string;
  followUp?: { lessonId: string; prompt: string };
} {
  if (input.correct) {
    return { lessonId: input.lessonId, comment: input.covered.join(''), followUp: undefined };
  }
  return {
    lessonId: input.lessonId,
    comment: input.missed.join(''),
    followUp: { lessonId: input.lessonId, prompt: input.similarPrompt },
  };
}
