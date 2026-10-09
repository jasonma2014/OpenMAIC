'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { DeskAccount } from '@/lib/saas/desk';

export interface SchoolLesson {
  stageId: string;
  orgId: string;
  classGroupId: string;
}

export function LessonClassPicker({
  title,
  onPrepared,
}: {
  title: string;
  onPrepared: (lesson: SchoolLesson) => void;
}) {
  const [desk, setDesk] = useState<DeskAccount | null>(null);
  const [classGroupId, setClassGroupId] = useState('');
  const [grade, setGrade] = useState('');
  const [subject, setSubject] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let active = true;
    fetch('/api/saas/school', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('请先登录学校');
        const account: DeskAccount = await response.json();
        if (!active) return;
        setDesk(account);
        const first = account.classes.find(
          (group) => account.role === 'org_admin' || group.adminUserId === account.userId,
        );
        setClassGroupId(first?.id ?? '');
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const classes =
    desk?.classes.filter(
      (group) => desk.role === 'org_admin' || group.adminUserId === desk.userId,
    ) ?? [];
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">选择这节课所属的班级</h1>
      <p>{desk?.orgName}</p>
      {classes.length ? (
        <select
          aria-label="课程所属班级"
          className="rounded-md border bg-background p-2"
          value={classGroupId}
          onChange={(event) => setClassGroupId(event.target.value)}
        >
          {classes.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
      ) : (
        <p>请先由学校管理员创建班级，并指定你为班级管理员。</p>
      )}
      <Input
        aria-label="课程年级"
        placeholder="年级（如三年级）"
        value={grade}
        maxLength={40}
        onChange={(e) => setGrade(e.target.value)}
      />
      <Input
        aria-label="课程科目"
        placeholder="科目（如数学）"
        value={subject}
        maxLength={40}
        onChange={(e) => setSubject(e.target.value)}
      />
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        disabled={!classGroupId || pending}
        onClick={async () => {
          if (pending) return;
          setPending(true);
          setError('');
          try {
            const response = await fetch('/api/saas/school', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                action: 'prepare-lesson',
                classGroupId,
                title,
                grade,
                subject,
              }),
            });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || '创建课程失败');
            onPrepared(body);
          } catch (err) {
            setError(err instanceof Error ? err.message : '创建课程失败');
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? '正在准备…' : '开始备课'}
      </Button>
      <Link href="/">返回学校首页</Link>
    </main>
  );
}
