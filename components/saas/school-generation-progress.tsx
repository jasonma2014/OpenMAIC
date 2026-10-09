'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import type { GenerationSessionState } from '@/app/generation-preview/types';
import type { SchoolGenerationJob } from '@/lib/saas/generation-jobs';
import { resolveSessionDocumentSources } from '@/lib/document/session-sources';
import { loadDocumentBlob } from '@/lib/utils/image-storage';
import { refreshSaasSession } from '@/lib/saas/use-saas-session';

const steps: Record<string, string> = {
  queued: '正在排队准备',
  initializing: '正在准备课堂',
  researching: '正在整理资料',
  generating_outlines: '正在写课程大纲',
  generating_scenes: '正在生成课件和讲解',
  generating_media: '正在制作配图和视频',
  generating_tts: '正在制作旁白',
  persisting: '正在保存课程',
  completed: '课程已完成，可以试听和修改',
};

export function SchoolGenerationProgress({
  stageId,
  session,
}: {
  stageId: string;
  session?: GenerationSessionState;
}) {
  const [job, setJob] = useState<SchoolGenerationJob | null>(null);
  const [error, setError] = useState('');
  const [preparing, setPreparing] = useState('正在读取课程进度');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const url = `/api/saas/lessons/${encodeURIComponent(stageId)}/generation`;
    async function check() {
      try {
        let response = await fetch(url, { cache: 'no-store' });
        let body = await response.json();
        if (!response.ok) throw new Error(body.error || '无法读取课程进度');
        if (!body.job && session) {
          setPreparing('正在读取备课资料');
          let text = session.pdfText;
          if (!text) {
            const parts: string[] = [];
            for (const source of resolveSessionDocumentSources(session)) {
              const blob = await loadDocumentBlob(source.storageKey);
              if (!(blob instanceof Blob)) throw new Error('备课资料已失效，请返回首页重新上传');
              const form = new FormData();
              form.append(
                'file',
                new File([blob], source.name, { type: source.mimeType || blob.type }),
              );
              const parsed = await fetch('/api/extract-document', { method: 'POST', body: form });
              const extracted = await parsed.json();
              if (!parsed.ok || !extracted.data?.text)
                throw new Error(extracted.error || '资料解析失败');
              parts.push(extracted.data.text);
            }
            text = parts.join('\n\n');
          }
          if (stopped) return;
          response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              requirement: session.requirements.requirement,
              lessonBrief: session.requirements.lessonBrief,
              ...(text
                ? {
                    pdfContent: {
                      text,
                      images: session.pdfImages?.map((image) => image.src) ?? [],
                    },
                  }
                : {}),
              enableWebSearch: !!session.requirements.webSearch,
              enableImageGeneration: true,
              enableTTS: true,
            }),
          });
          body = await response.json();
          if (!response.ok) throw new Error(body.error || '无法开始生成');
        }
        if (stopped) return;
        if (!body.job) throw new Error('这节课还没有开始生成，请从备课页开始');
        setJob(body.job);
        setError('');
        if (body.job.status === 'succeeded') {
          await refreshSaasSession();
          return;
        }
        if (body.job.status !== 'failed') timer = setTimeout(() => void check(), 2000);
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : '读取进度失败');
      }
    }
    void check();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [stageId, session, attempt]);
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">
        {job?.status === 'failed' ? '生成未完成' : (steps[job?.step ?? ''] ?? preparing)}
      </h1>
      {job ? (
        <>
          <progress className="w-full" aria-label="课程生成进度" value={job.progress} max={100} />
          {job.totalScenes ? (
            <p>
              课件已完成 {job.scenesGenerated} / {job.totalScenes} 页
            </p>
          ) : null}
          {['generating_media', 'generating_tts'].includes(job.step) && job.itemsTotal ? (
            <p>
              {job.step === 'generating_tts' ? '旁白' : '配图和视频'}已处理{' '}
              {job.itemsCompleted ?? 0} / {job.itemsTotal} 项
            </p>
          ) : null}
          {job.mediaFailed || job.ttsFailed ? (
            <p role="status">
              {job.mediaFailed ? `${job.mediaFailed} 项配图或视频未生成。` : ''}
              {job.ttsFailed ? `${job.ttsFailed} 段旁白未生成。` : ''}请试听检查后再发布。
            </p>
          ) : null}
          {job.error ? (
            <p role="alert" className="text-destructive">
              {job.error}
            </p>
          ) : null}
        </>
      ) : null}
      <p className="text-muted-foreground">可以离开页面，稍后从学校首页的“备课进度”回来查看。</p>
      {error ? (
        <>
          <p role="alert" className="text-destructive">
            {error}
          </p>
          <Button onClick={() => setAttempt((value) => value + 1)}>重新读取进度</Button>
        </>
      ) : null}
      {job?.status === 'succeeded' ? (
        <Link
          className="rounded-md bg-primary px-4 py-2 text-center text-primary-foreground"
          href={`/classroom/${encodeURIComponent(stageId)}`}
        >
          试听并修改这节课
        </Link>
      ) : null}
      <Link href="/">返回学校首页</Link>
    </main>
  );
}
