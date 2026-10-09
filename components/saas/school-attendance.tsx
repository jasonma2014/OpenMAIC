'use client';
import { useEffect, useState } from 'react';
import { useSaasSession } from '@/lib/saas/use-saas-session';

export function SchoolAttendance({ stageId, ready }: { stageId: string; ready: boolean }) {
  const session = useSaasSession();
  const student = session.status === 'signed-in' && session.account.role === 'student';
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!student || !ready) return;
    let active = true;
    fetch(`/api/saas/lessons/${encodeURIComponent(stageId)}/results`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'attend' }),
    })
      .then((response) => {
        if (active) setError(!response.ok);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [stageId, student, ready, attempt]);
  return error ? (
    <button
      className="bg-amber-50 p-2 text-sm text-amber-900"
      onClick={() => setAttempt((value) => value + 1)}
    >
      到课记录未同步，点击重试
    </button>
  ) : null;
}
