import { expect, it } from 'vitest';
import type { Scene } from '@/lib/types/stage';
import { reviseLessonScene } from '@/lib/saas/lesson-revision';

const theme = {
  backgroundColor: '#fff',
  themeColors: ['#123456'],
  fontColor: '#000',
  fontName: 'Arial',
};
const slide: Scene = {
  id: 'scene-1',
  stageId: 'lesson-1',
  type: 'slide',
  title: '分数',
  order: 0,
  content: {
    type: 'slide',
    canvas: { id: 'canvas-1', viewportSize: 1000, viewportRatio: 0.5625, theme, elements: [] },
  },
  actions: [{ id: 'speech-1', type: 'speech', text: '旧讲解', audioId: 'cached-audio' }],
};

it('changes one narration and invalidates its previous audio without replacing the lesson', () => {
  const revised = reviseLessonScene(slide, {
    kind: 'speech',
    id: 'speech-1',
    text: '分数表示整体的一部分。',
  });
  expect(revised.id).toBe('scene-1');
  expect(revised.actions?.[0]).toEqual({
    id: 'speech-1',
    type: 'speech',
    text: '分数表示整体的一部分。',
  });
  expect(slide.actions?.[0]).toMatchObject({ text: '旧讲解', audioId: 'cached-audio' });
});

it('replaces one picture while keeping its size and position', () => {
  const pictured: Scene = {
    ...slide,
    content: {
      type: 'slide',
      canvas: {
        id: 'canvas-1',
        viewportSize: 1000,
        viewportRatio: 0.5625,
        theme,
        elements: [
          {
            id: 'image-1',
            type: 'image',
            src: 'old-image',
            left: 12,
            top: 34,
            width: 300,
            height: 200,
            rotate: 0,
            fixedRatio: true,
          },
        ],
      },
    },
  };
  const revised = reviseLessonScene(pictured, {
    kind: 'image',
    id: 'image-1',
    src: 'asset-new-image',
  });
  expect(revised.content).toMatchObject({
    canvas: {
      elements: [
        { id: 'image-1', src: 'asset-new-image', left: 12, top: 34, width: 300, height: 200 },
      ],
    },
  });
});

it('corrects a quiz question and its answer without changing other questions', () => {
  const original = {
    id: 'q1',
    type: 'single' as const,
    question: '1 + 1 = ?',
    options: [
      { label: '1', value: 'A' },
      { label: '2', value: 'B' },
    ],
    answer: ['A'],
  };
  const quiz: Scene = {
    ...slide,
    type: 'quiz',
    content: { type: 'quiz', questions: [original, { ...original, id: 'q2' }] },
  };
  const revised = reviseLessonScene(quiz, {
    kind: 'quiz',
    id: 'q1',
    question: { ...original, question: '一加一等于几？', answer: ['B'] },
  });
  expect(revised.content).toMatchObject({
    questions: [
      { id: 'q1', question: '一加一等于几？', answer: ['B'] },
      { id: 'q2', answer: ['A'] },
    ],
  });
});

it('applies a shortcut to one narration and leaves the other sentence alone', () => {
  const two: Scene = {
    ...slide,
    actions: [
      { id: 'speech-1', type: 'speech', text: '把饼平均分成两块。每一块都一样大。' },
      { id: 'speech-2', type: 'speech', text: '其中一块是二分之一。要记住平均分。' },
    ],
  };
  const revised = reviseLessonScene(two, {
    kind: 'shortcut',
    role: 'teacher',
    id: 'speech-2',
    shortcut: 'simpler',
  });
  expect(revised.actions?.[0]).toMatchObject({ id: 'speech-1', text: '把饼平均分成两块。每一块都一样大。' });
  expect(revised.actions?.[1]?.text).toBe('其中一块是二分之一。');
  expect(() =>
    reviseLessonScene(two, { kind: 'shortcut', role: 'student', id: 'speech-2', shortcut: 'simpler' }),
  ).toThrow(/学生/);
});

it('changes the exercise type of one question', () => {
  const original = {
    id: 'q1',
    type: 'single' as const,
    question: '词义',
    options: [{ value: 'A', label: '甲' }],
    answer: ['A'],
    exerciseType: 'choice' as const,
  };
  const quiz: Scene = {
    ...slide,
    type: 'quiz',
    content: { type: 'quiz', questions: [original, { ...original, id: 'q2', question: '另一题' }] },
  };
  const revised = reviseLessonScene(quiz, {
    kind: 'exercise-type',
    id: 'q2',
    exerciseType: 'match',
  });
  expect(revised.content).toMatchObject({
    questions: [
      { id: 'q1', exerciseType: 'choice' },
      { id: 'q2', exerciseType: 'match' },
    ],
  });
});
