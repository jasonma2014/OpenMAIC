'use client';

import { useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useI18n } from '@/lib/hooks/use-i18n';
import { canPerform } from '@/lib/saas/roles';
import { useSaasSession } from '@/lib/saas/use-saas-session';
import { useStageStore } from '@/lib/store';
import { copyPlainText } from '@/lib/utils/copy-text';

export function PublishClassButton() {
  const { t } = useI18n();
  const session = useSaasSession();
  const stageId = useStageStore((state) => state.stage?.id ?? null);
  const [classCode, setClassCode] = useState('');
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  if (session.status !== 'signed-in' || !canPerform(session.account.role, 'publish') || !stageId) {
    return null;
  }

  async function publish() {
    if (!stageId) return;
    setPending(true);
    setError('');
    try {
      const response = await fetch(`/api/stages/${encodeURIComponent(stageId)}/publish`, {
        method: 'POST',
        credentials: 'include',
      });
      const body = (await response.json().catch(() => null)) as { classCode?: string } | null;
      if (!response.ok || !body?.classCode) {
        setClassCode('');
        setError(t('saas.publishFailed'));
        setOpen(true);
        return;
      }
      setClassCode(body.classCode);
      setCopied(false);
      setOpen(true);
    } catch {
      setError(t('saas.publishFailed'));
      setOpen(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => void publish()}
      >
        {pending ? t('common.loading') : t('saas.publish')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setCopied(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{error ? t('saas.publishFailed') : t('saas.classCodeReady')}</DialogTitle>
            <DialogDescription>{error || t('saas.classCodeHint')}</DialogDescription>
          </DialogHeader>
          {classCode ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
              <input
                ref={codeRef}
                readOnly
                value={classCode}
                aria-label={t('saas.classCode')}
                className="min-w-0 flex-1 bg-transparent font-mono text-lg tracking-widest outline-none"
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  void copyPlainText(classCode, codeRef.current).then((ok) => {
                    if (ok) setCopied(true);
                  });
                }}
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? t('saas.copied') : t('saas.copy')}
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
