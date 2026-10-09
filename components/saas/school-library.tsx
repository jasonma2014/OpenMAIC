'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { SchoolLibraryLesson } from '@/lib/saas/lesson-library';

export function SchoolLibrary({ classes }: { classes: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [lessons, setLessons] = useState<SchoolLibraryLesson[]>([]);
  const [grade, setGrade] = useState('');
  const [subject, setSubject] = useState('');
  const [target, setTarget] = useState(classes[0]?.id ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/saas/lessons?${new URLSearchParams({ grade, subject })}`, {
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '读取课程库失败');
      setLessons(body.lessons);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取课程库失败');
    }
  }, [grade, subject]);
  useEffect(() => {
    void load();
  }, [load]);
  const act = async (body: Record<string, unknown>) => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/saas/lessons', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '操作失败');
      if (body.action === 'reuse') router.push(`/classroom/${result.stageId}`);
      else await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <h2 className="font-semibold">校内课程库</h2>
      <p className="text-sm text-muted-foreground">筛选课程，复制到你管理的班级后修改使用。</p>
      <div className="flex gap-2">
        <Input
          aria-label="筛选年级"
          placeholder="年级（全部）"
          value={grade}
          maxLength={40}
          onChange={(e) => setGrade(e.target.value)}
        />
        <Input
          aria-label="筛选科目"
          placeholder="科目（全部）"
          value={subject}
          maxLength={40}
          onChange={(e) => setSubject(e.target.value)}
        />
      </div>
      {classes.length ? (
        <label className="flex items-center gap-2 text-sm">
          复制到班级
          <select
            aria-label="复制目标班级"
            className="rounded border bg-background p-2"
            value={target || classes[0]?.id}
            onChange={(e) => setTarget(e.target.value)}
          >
            {classes.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      {!lessons.length ? (
        <p className="text-sm text-muted-foreground">暂无符合条件的课程。</p>
      ) : null}
      {lessons.map((lesson) => (
        <article key={lesson.stageId} className="space-y-2 rounded border p-3">
          <Link className="font-medium underline" href={`/classroom/${lesson.stageId}`}>
            {lesson.title}
          </Link>
          <p className="text-sm">
            {lesson.className} · {lesson.grade || '未分年级'} · {lesson.subject || '未分科目'} ·{' '}
            {lesson.isPublic ? '已发布' : '未发布'}
          </p>
          {lesson.canEdit ? (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void act({
                  action: 'classify',
                  stageId: lesson.stageId,
                  grade: data.get('grade'),
                  subject: data.get('subject'),
                });
              }}
            >
              <Input
                className="w-28"
                name="grade"
                aria-label={`${lesson.title}年级`}
                defaultValue={lesson.grade}
                maxLength={40}
                placeholder="年级"
              />
              <Input
                className="w-28"
                name="subject"
                aria-label={`${lesson.title}科目`}
                defaultValue={lesson.subject}
                maxLength={40}
                placeholder="科目"
              />
              <Button size="sm" variant="outline" disabled={pending}>
                保存分类
              </Button>
            </form>
          ) : null}
          {classes.length ? (
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                void act({
                  action: 'reuse',
                  stageId: lesson.stageId,
                  classGroupId: target || classes[0]?.id,
                })
              }
            >
              复制到所选班级
            </Button>
          ) : null}
        </article>
      ))}
    </section>
  );
}
