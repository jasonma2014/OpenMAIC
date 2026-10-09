import type { Scene } from '@/lib/types/stage';
import type { QuizQuestion } from '@openmaic/dsl';
import {
  applyRevisionShortcut,
  type ExerciseType,
  type RevisionShortcut,
} from '@/lib/saas/lesson-craft';

export type LessonRevision =
  | { kind: 'speech'; id: string; text: string }
  | { kind: 'image'; id: string; src: string }
  | { kind: 'quiz'; id: string; question: QuizQuestion }
  | {
      kind: 'shortcut';
      role: 'teacher' | 'org_admin' | 'student';
      id: string;
      shortcut: RevisionShortcut;
    }
  | { kind: 'exercise-type'; id: string; exerciseType: ExerciseType };

function shorterSpeech(text: string): string {
  const first = text.split('。')[0] ?? text;
  return first.endsWith('。') ? first : `${first}。`;
}

/** A local lesson correction preserves scene identity and unrelated content. */
export function reviseLessonScene(scene: Scene, revision: LessonRevision): Scene {
  if (revision.kind === 'shortcut') {
    const speeches = (scene.actions ?? []).filter((action) => action.type === 'speech');
    let marked: Array<{ id: string; text: string; instruction?: string }>;
    try {
      marked = applyRevisionShortcut({
        role: revision.role,
        segments: speeches.map((action) => ({ id: action.id, text: action.text })),
        selectedId: revision.id,
        shortcut: revision.shortcut,
      });
    } catch {
      throw new Error('学生不能修改这节课');
    }
    const selected = marked.find((segment) => segment.id === revision.id);
    const text =
      revision.shortcut === 'simpler'
        ? shorterSpeech(selected?.text ?? '')
        : revision.shortcut === 'life-example'
          ? `${selected?.text ?? ''}比如在生活里，可以把一个苹果平均切开。`
          : `${selected?.text ?? ''}\n练习：用自己的话说一遍。`;
    return reviseLessonScene(scene, { kind: 'speech', id: revision.id, text });
  }
  if (revision.kind === 'exercise-type') {
    if (scene.content.type !== 'quiz') throw new Error('找不到这道练习题');
    return {
      ...scene,
      type: 'quiz',
      content: {
        ...scene.content,
        questions: scene.content.questions.map((question) =>
          question.id === revision.id
            ? { ...question, exerciseType: revision.exerciseType }
            : question,
        ),
      },
    };
  }
  if (revision.kind === 'quiz') {
    if (
      scene.content.type !== 'quiz' ||
      !revision.question.question.trim() ||
      !scene.content.questions.some((question) => question.id === revision.id)
    )
      throw new Error('找不到这道练习题');
    return {
      ...scene,
      type: 'quiz',
      content: {
        ...scene.content,
        questions: scene.content.questions.map((question) =>
          question.id === revision.id ? { ...revision.question, id: question.id } : question,
        ),
      },
    };
  }
  if (revision.kind === 'image') {
    if (
      scene.content.type !== 'slide' ||
      !revision.src.trim() ||
      !scene.content.canvas.elements.some(
        (element) => element.id === revision.id && element.type === 'image',
      )
    )
      throw new Error('找不到这张配图');
    return {
      ...scene,
      type: 'slide',
      content: {
        ...scene.content,
        canvas: {
          ...scene.content.canvas,
          elements: scene.content.canvas.elements.map((element) =>
            element.id === revision.id && element.type === 'image'
              ? { ...element, src: revision.src }
              : element,
          ),
        },
      },
    };
  }
  if (!revision.text.trim()) throw new Error('讲解不能为空');
  if (!scene.actions?.some((action) => action.id === revision.id && action.type === 'speech'))
    throw new Error('找不到这句讲解');
  return {
    ...scene,
    actions: scene.actions.map((action) => {
      if (action.id !== revision.id || action.type !== 'speech' || action.text === revision.text)
        return action;
      const { audioId: _oldAudio, ...speech } = action;
      return { ...speech, text: revision.text };
    }),
  };
}
