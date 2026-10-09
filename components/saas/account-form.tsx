'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { BrandLockup } from '@/components/brand/brand-lockup';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/hooks/use-i18n';
import { refreshSaasSession } from '@/lib/saas/use-saas-session';

type AccountMode = 'login' | 'register-teacher' | 'register-student';

export function AccountForm({ mode }: { mode: AccountMode }) {
  const { t } = useI18n();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [action, setAction] = useState<'create' | 'join'>('create');
  const [orgName, setOrgName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError('');
    const path = mode === 'login' ? '/api/saas/login' : '/api/saas/register';
    const payload =
      mode === 'login'
        ? { email, password }
        : {
            email,
            password,
            name,
            kind: mode === 'register-teacher' ? 'teacher' : 'student',
            ...(mode === 'register-teacher'
              ? action === 'create'
                ? { action: 'create', orgName }
                : { action: 'join', joinCode }
              : joinCode.trim()
                ? { joinCode }
                : {}),
          };
    try {
      const response = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error || t('saas.failed'));
        return;
      }
      await refreshSaasSession();
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
        {mode !== 'login' ? (
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('saas.personName')}
            autoComplete="name"
            required
          />
        ) : null}
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
        {mode === 'register-teacher' ? (
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="teacher-action"
                checked={action === 'create'}
                onChange={() => setAction('create')}
              />
              {t('saas.createSchool')}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="teacher-action"
                checked={action === 'join'}
                onChange={() => setAction('join')}
              />
              {t('saas.joinSchool')}
            </label>
            {action === 'create' ? (
              <Input
                value={orgName}
                onChange={(event) => setOrgName(event.target.value)}
                placeholder={t('saas.orgName')}
                required
              />
            ) : (
              <Input
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder={t('saas.joinCode')}
                required
              />
            )}
          </div>
        ) : null}
        {mode === 'register-student' ? (
          <Input
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            placeholder={t('saas.joinCodeOptional')}
          />
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t('common.loading') : t(`saas.${mode}Submit`)}
        </Button>
        <div className="flex flex-wrap justify-between gap-2 text-sm text-muted-foreground">
          {mode !== 'login' ? <Link href="/login">{t('saas.loginTitle')}</Link> : null}
          {mode !== 'register-teacher' ? (
            <Link href="/register/teacher">{t('saas.register-teacherTitle')}</Link>
          ) : null}
          {mode !== 'register-student' ? (
            <Link href="/register/student">{t('saas.register-studentTitle')}</Link>
          ) : null}
        </div>
      </form>
    </main>
  );
}
