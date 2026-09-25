'use client';

import { useEffect, useState } from 'react';

import { useSaasMode } from '@/components/saas/saas-mode';
import { parseSaasSession, type SaasSession } from '@/lib/saas/session-state';

type SessionSnapshot = SaasSession | { status: 'loading' };

let snapshot: SessionSnapshot = { status: 'loading' };
const listeners = new Set<(next: SessionSnapshot) => void>();

function publish(next: SessionSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener(next);
}

export async function refreshSaasSession(): Promise<SaasSession> {
  const response = await fetch('/api/saas/session', { credentials: 'include', cache: 'no-store' });
  const body = await response.json().catch(() => null);
  const next = parseSaasSession(response.status, body);
  publish(next);
  return next;
}

/** Reload the header balance after a billed request finishes. */
export function refreshBalanceAfterSpend(): void {
  if (typeof window === 'undefined') return;
  const flagged = (window as Window & { __OPENMAIC_SAAS__?: boolean }).__OPENMAIC_SAAS__ === true;
  if (!flagged) return;
  void refreshSaasSession();
}

export async function signOutSaas(): Promise<void> {
  await fetch('/api/saas/logout', { method: 'POST', credentials: 'include' });
  publish({ status: 'signed-out' });
}

export function useSaasSession(): SessionSnapshot {
  const enabled = useSaasMode();
  const [state, setState] = useState<SessionSnapshot>(enabled ? snapshot : { status: 'off' });

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'off' });
      return;
    }
    const listener = (next: SessionSnapshot) => setState(next);
    listeners.add(listener);
    setState(snapshot);
    if (snapshot.status === 'loading') void refreshSaasSession();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshSaasSession();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      listeners.delete(listener);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);

  return state;
}
