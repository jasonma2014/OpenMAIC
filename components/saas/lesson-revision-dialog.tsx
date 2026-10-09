'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useStageStore } from '@/lib/store/stage';
import { useSaasSession } from '@/lib/saas/use-saas-session';
import { reviseLessonScene, type LessonRevision } from '@/lib/saas/lesson-revision';
import { putAsset } from '@/lib/media/asset-pool';

export function LessonRevisionDialog() {
  const session = useSaasSession();
  const scenes = useStageStore((state) => state.scenes);
  const currentSceneId = useStageStore((state) => state.currentSceneId);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const scene = scenes.find((item) => item.id === (selected || currentSceneId)) ?? scenes[0];
  if (session.status !== 'signed-in' || session.account.role === 'student') return null;

  async function save(revision: LessonRevision) {
    if (!scene || pending) return;
    setPending(true);
    setMessage('');
    try {
      const store = useStageStore.getState();
      const latest = store.scenes.find((item) => item.id === scene.id);
      if (!latest) throw new Error('页面已发生变化，请重新选择');
      const changed = reviseLessonScene(latest, revision);
      store.updateScene(scene.id, { content: changed.content, actions: changed.actions });
      if (!(await useStageStore.getState().saveToStorage()))
        throw new Error('保存失败，请检查权限或网络后重试');
      setMessage('已保存，可以回到课堂重新试听。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setOpen(true);
          setMessage('');
        }}
      >
        修改这节课
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>修改讲解、配图和练习</DialogTitle>
            <DialogDescription>
              每次只保存当前修改，完成后回到课堂试听，再发出课程码。
            </DialogDescription>
          </DialogHeader>
          <select
            aria-label="要修改的页面"
            className="rounded-md border bg-background p-2"
            value={scene?.id ?? ''}
            onChange={(event) => setSelected(event.target.value)}
          >
            {scenes.map((item, index) => (
              <option key={item.id} value={item.id}>
                第 {index + 1} 页 · {item.title}
              </option>
            ))}
          </select>
          <div key={scene?.id} className="space-y-4">
            {scene?.actions
              ?.filter((action) => action.type === 'speech')
              .map((action) => (
                <form
                  key={action.id}
                  className="space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void save({
                      kind: 'speech',
                      id: action.id,
                      text: String(new FormData(event.currentTarget).get('text') ?? ''),
                    });
                  }}
                >
                  <label className="block text-sm">
                    讲解
                    <textarea
                      aria-label="讲解文本"
                      name="text"
                      className="mt-1 min-h-24 w-full rounded-md border p-2"
                      defaultValue={action.text}
                      required
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={pending}>
                      保存这句讲解
                    </Button>
                    {(
                      [
                        ['simpler', '讲简单一点'],
                        ['life-example', '换个生活例子'],
                        ['add-exercise', '增加一道练习'],
                      ] as const
                    ).map(([shortcut, label]) => (
                      <Button
                        key={shortcut}
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          void save({
                            kind: 'shortcut',
                            role: session.account.role === 'org_admin' ? 'org_admin' : 'teacher',
                            id: action.id,
                            shortcut,
                          })
                        }
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                </form>
              ))}
            {scene?.content.type === 'slide'
              ? scene.content.canvas.elements
                  .filter((element) => element.type === 'image')
                  .map((element, index) => (
                    <label key={element.id} className="block space-y-2 text-sm">
                      <span>更换配图 {index + 1}</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        disabled={pending}
                        onChange={async (event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;
                          if (file.size > 10 * 1024 * 1024) {
                            setMessage('图片不能超过 10 MB');
                            return;
                          }
                          try {
                            const src = await putAsset(
                              file,
                              { contentType: file.type },
                              { stageId: scene.stageId },
                            );
                            await save({ kind: 'image', id: element.id, src });
                          } catch {
                            setMessage('上传图片失败，请重试');
                          }
                        }}
                      />
                    </label>
                  ))
              : null}
            {scene?.content.type === 'quiz'
              ? scene.content.questions.map((question) => (
                  <form
                    key={question.id}
                    className="space-y-2 rounded-lg border p-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      void save({
                        kind: 'quiz',
                        id: question.id,
                        question: {
                          ...question,
                          question: String(form.get('question')),
                          ...(question.options
                            ? {
                                options: question.options.map((option) => ({
                                  ...option,
                                  label: String(form.get(`option-${option.value}`)),
                                })),
                                answer: String(form.get('answer') ?? '')
                                  .split(',')
                                  .map((value) => value.trim())
                                  .filter(Boolean),
                              }
                            : {}),
                          analysis: String(form.get('analysis') ?? ''),
                        },
                      });
                    }}
                  >
                    <label className="block text-sm">
                      题型
                      <select
                        className="mt-1 w-full rounded-md border bg-background p-2"
                        value={question.exerciseType ?? 'choice'}
                        onChange={(event) =>
                          void save({
                            kind: 'exercise-type',
                            id: question.id,
                            exerciseType: event.target.value as
                              | 'order'
                              | 'match'
                              | 'classify'
                              | 'choice',
                          })
                        }
                      >
                        <option value="choice">选择题</option>
                        <option value="order">排序</option>
                        <option value="match">配对</option>
                        <option value="classify">分类</option>
                      </select>
                    </label>
                    <label className="block text-sm">
                      题目
                      <textarea
                        name="question"
                        className="mt-1 w-full rounded-md border p-2"
                        defaultValue={question.question}
                        required
                      />
                    </label>
                    {question.options?.map((option) => (
                      <label key={option.value} className="flex items-center gap-2 text-sm">
                        {option.value}
                        <input
                          className="flex-1 rounded-md border p-2"
                          name={`option-${option.value}`}
                          defaultValue={option.label}
                          required
                        />
                      </label>
                    ))}
                    {question.options ? (
                      <label className="block text-sm">
                        正确答案（多选用逗号分隔）
                        <input
                          name="answer"
                          className="mt-1 w-full rounded-md border p-2"
                          defaultValue={question.answer?.join(',')}
                        />
                      </label>
                    ) : null}
                    <label className="block text-sm">
                      解析
                      <textarea
                        name="analysis"
                        className="mt-1 w-full rounded-md border p-2"
                        defaultValue={question.analysis}
                      />
                    </label>
                    <Button size="sm" disabled={pending}>
                      保存这道练习
                    </Button>
                  </form>
                ))
              : null}
          </div>
          {message ? (
            <p role="status" className="text-sm">
              {message}
            </p>
          ) : null}
          <Button variant="outline" onClick={() => setOpen(false)}>
            回到课堂试听
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
