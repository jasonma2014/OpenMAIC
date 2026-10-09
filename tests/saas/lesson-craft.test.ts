import { describe, expect, it } from 'vitest';

import {
  LessonCraftError,
  applyExerciseOverride,
  applyRevisionShortcut,
  assertLessonBrief,
  composeLessonRequirement,
  exerciseTypeFor,
  masteryFromAnswers,
  reviewOpenAnswer,
} from '@/lib/saas/lesson-craft';

const brief = {
  grade: '三年级',
  textbook: '数学上册',
  periods: '1课时',
  objectives: '能说出分数表示的是平均分后的几份',
  baseline: '会平均分一个东西',
};

describe('lesson brief', () => {
  it('requires a grade and an objective before generation', () => {
    expect(assertLessonBrief(brief)).toEqual(brief);
    expect(() => assertLessonBrief({ ...brief, grade: '  ' })).toThrow(LessonCraftError);
    expect(() => assertLessonBrief({ ...brief, objectives: '' })).toThrow(LessonCraftError);
  });

  it('puts the brief into the shared class requirement', () => {
    const text = composeLessonRequirement(brief, '什么是分数');
    expect(text).toContain('三年级');
    expect(text).toContain('能说出分数表示的是平均分后的几份');
    expect(text).toContain('什么是分数');
    expect(text).toContain('实验步骤用排序');
    expect(text).toContain('词义用配对');
  });
});

describe('teacher revision shortcuts', () => {
  const segments = [
    { id: 'p1', text: '把一个饼平均分成两块' },
    { id: 'p2', text: '其中一块就是二分之一' },
  ];

  it('changes only the selected segment and refuses a student', () => {
    const revised = applyRevisionShortcut({
      role: 'teacher',
      segments,
      selectedId: 'p2',
      shortcut: 'life-example',
    });
    expect(revised.find((segment) => segment.id === 'p1')?.text).toBe(segments[0].text);
    expect(revised.find((segment) => segment.id === 'p2')?.instruction).toBe('换个生活例子');
    expect(() =>
      applyRevisionShortcut({ role: 'student', segments, selectedId: 'p2', shortcut: 'simpler' }),
    ).toThrow(LessonCraftError);
  });
});

describe('mastery from submitted answers', () => {
  it('lists unmastered points and the students who need help', () => {
    const report = masteryFromAnswers([
      { studentId: 's1', studentName: '李同学', point: '分数的意义', correct: false },
      { studentId: 's1', studentName: '李同学', point: '平均分', correct: true },
      { studentId: 's2', studentName: '王同学', point: '分数的意义', correct: true },
    ]);
    expect(report.unmastered).toEqual(['分数的意义']);
    expect(report.studentsNeedingHelp).toEqual([
      { studentId: 's1', studentName: '李同学', points: ['分数的意义'] },
    ]);
  });
});

describe('exercise type by knowledge point', () => {
  it('picks ordering, matching, or classification, and a teacher can change one question', () => {
    expect(exerciseTypeFor('procedure')).toBe('order');
    expect(exerciseTypeFor('vocabulary')).toBe('match');
    expect(exerciseTypeFor('distinction')).toBe('classify');
    expect(exerciseTypeFor('fact')).toBe('choice');
    const questions = [
      { id: 'q1', type: 'choice' as const },
      { id: 'q2', type: 'choice' as const },
    ];
    const next = applyExerciseOverride(questions, 'q2', 'order');
    expect(next).toEqual([
      { id: 'q1', type: 'choice' },
      { id: 'q2', type: 'order' },
    ]);
  });
});

describe('open answer review', () => {
  it('praises a correct answer and keeps a retry inside the same lesson', () => {
    expect(
      reviewOpenAnswer({
        lessonId: 'lesson-1',
        correct: true,
        covered: ['四步都说到了'],
        missed: [],
        similarPrompt: '再讲一个买苹果的例子',
      }),
    ).toEqual({ lessonId: 'lesson-1', comment: '四步都说到了', followUp: undefined });

    const wrong = reviewOpenAnswer({
      lessonId: 'lesson-1',
      correct: false,
      covered: [],
      missed: ['还没说到根据反馈修改'],
      similarPrompt: '再讲一个买苹果的例子',
    });
    expect(wrong.comment).toContain('还没说到根据反馈修改');
    expect(wrong.followUp).toEqual({ lessonId: 'lesson-1', prompt: '再讲一个买苹果的例子' });
  });
});
