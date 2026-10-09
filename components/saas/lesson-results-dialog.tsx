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
import type { lessonResults } from '@/lib/saas/learning-results';
type Report = Awaited<ReturnType<typeof lessonResults>> & { totalQuestions: number };

export function LessonResultsDialog() {
  const session = useSaasSession();
  const stageId = useStageStore((state) => state.stage?.id);
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  if (!stageId || session.status !== 'signed-in' || session.account.role === 'student') return null;
  const url = `/api/saas/lessons/${encodeURIComponent(stageId)}/results`;
  async function load() {
    setError('');
    setPending(true);
    try {
      const response = await fetch(url, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '读取结果失败');
      setReport(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取结果失败');
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
          void load();
        }}
      >
        上课结果
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>上课结果 · {report?.students.length ?? 0} 人到课</DialogTitle>
            <DialogDescription>
              每位学生显示各页最近一次提交。选择题自动判定，简答题在下方批阅。
            </DialogDescription>
          </DialogHeader>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => void load()}>
            {pending ? '正在读取…' : '刷新结果'}
          </Button>
          {report?.mastery && report.mastery.unmastered.length > 0 ? (
            <div className="rounded-lg border p-3 text-sm">
              <p>还没掌握：{report.mastery.unmastered.join('、')}</p>
              <ul className="mt-2 space-y-1">
                {report.mastery.studentsNeedingHelp.map((student) => (
                  <li key={student.studentId}>
                    {student.studentName}需要帮助：{student.points.join('、')}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {report?.students.map((student) => (
            <details key={student.userId} className="rounded-lg border p-3">
              <summary>
                {student.name} · 已答 {student.completed}/{report.totalQuestions} · 对{' '}
                {student.correct} · 错 {student.incorrect} · 待批 {student.pendingReview}
              </summary>
              <p className="mt-2 text-xs text-muted-foreground">
                {student.email} · 首次到课 {new Date(student.firstSeenAt).toLocaleString()}
              </p>
              {student.answers.map((answer) => (
                <div
                  key={`${answer.sceneId}-${answer.questionId}`}
                  className="mt-3 space-y-1 border-t pt-2 text-sm"
                >
                  <p>{answer.question}</p>
                  <p>
                    学生答案：
                    {Array.isArray(answer.answer)
                      ? answer.answer.join('、')
                      : answer.answer || '未作答'}
                  </p>
                  <p>{answer.correct === null ? '待批阅' : answer.correct ? '正确' : '错误'}</p>
                  {answer.correct === null ? (
                    <div className="flex gap-2">
                      {[true, false].map((correct) => (
                        <Button
                          key={String(correct)}
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={async () => {
                            setPending(true);
                            setError('');
                            try {
                              const response = await fetch(url, {
                                method: 'POST',
                                headers: { 'content-type': 'application/json' },
                                body: JSON.stringify({
                                  action: 'review',
                                  studentId: student.userId,
                                  sceneId: answer.sceneId,
                                  attemptId: answer.attemptId,
                                  questionId: answer.questionId,
                                  correct,
                                }),
                              });
                              if (!response.ok) throw new Error('保存批阅失败');
                              await load();
                            } catch (err) {
                              setError(err instanceof Error ? err.message : '保存失败');
                            } finally {
                              setPending(false);
                            }
                          }}
                        >
                          {correct ? '判为正确' : '判为错误'}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </details>
          ))}
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
