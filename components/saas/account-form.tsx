'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { BrandLockup } from '@/components/brand/brand-lockup';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/hooks/use-i18n';
import { refreshSaasSession } from '@/lib/saas/use-saas-session';

type AccountMode = 'login' | 'register' | 'join';

export function AccountForm({ mode }: { mode: AccountMode }) {
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError('');
    const path =
      mode === 'register'
        ? '/api/saas/register'
        : mode === 'join'
          ? '/api/saas/join'
          : '/api/saas/login';
    const payload =
      mode === 'register'
        ? { email, password, orgName }
        : mode === 'join'
          ? { email, password, code }
          : { email, password };
    try {
      const response = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        stageId?: string;
      } | null;
      if (!response.ok) {
        setError(body?.error || t('saas.failed'));
        return;
      }
      await refreshSaasSession();
      if (mode === 'join' && body?.stageId) {
        router.push(`/classroom/${body.stageId}`);
        return;
      }
      router.push('/');
    } catch {
      setError(t('saas.failed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="min-h-[100dvh] flex items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-2xl border bg-background p-6 shadow-sm"
      >
        <BrandLockup size="header" />
        <div>
          <h1 className="text-xl font-semibold">{t(`saas.${mode}Title`)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t(`saas.${mode}Hint`)}</p>
        </div>
        {mode === 'register' && (
          <Input
            value={orgName}
            onChange={(event) => setOrgName(event.target.value)}
            placeholder={t('saas.orgName')}
            autoComplete="organization"
            required
          />
        )}
        {mode === 'join' && (
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder={t('saas.classCode')}
            autoComplete="off"
            maxLength={8}
            required
          />
        )}
        <Input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={t('saas.email')}
          autoComplete="email"
          required
        />
        <Input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={t('saas.password')}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength={8}
          required
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t('common.loading') : t(`saas.${mode}Submit`)}
        </Button>
        <div className="flex justify-between text-sm text-muted-foreground">
          {mode !== 'login' ? <Link href="/login">{t('saas.loginTitle')}</Link> : <span />}
          {mode !== 'register' ? <Link href="/register">{t('saas.registerTitle')}</Link> : <span />}
          {mode !== 'join' ? <Link href="/join">{t('saas.joinTitle')}</Link> : <span />}
        </div>
      </form>
    </main>
  );
}
