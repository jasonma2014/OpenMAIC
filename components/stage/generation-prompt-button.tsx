'use client';

import { useState } from 'react';
import { Check, Copy, TextQuote } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { readGenerationPrompts } from '@/lib/classroom/generation-prompt';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useStageStore } from '@/lib/store';
import { copyPlainText } from '@/lib/utils/copy-text';

export function GenerationPromptButton() {
  const { t, locale } = useI18n();
  const isOwner = useStageStore((state) => state.isOwner);
  const stored = useStageStore((state) => state.stage?.generationPrompts);
  const prompts = isOwner ? readGenerationPrompts(stored) : [];
  const [open, setOpen] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  if (prompts.length === 0) return null;

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          setCopiedIndex(null);
          setOpen(true);
        }}
      >
        <TextQuote className="size-4" />
        {t('stage.generationPrompt')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setCopiedIndex(null);
        }}
      >
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('stage.generationPromptTitle')}</DialogTitle>
            <DialogDescription>{t('stage.generationPromptHint')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {prompts.map((prompt, index) => {
              const time =
                prompt.createdAt > 0
                  ? new Date(prompt.createdAt).toLocaleString(locale, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })
                  : '';
              return (
                <div key={`${prompt.createdAt}-${index}`} className="rounded-lg border p-3">
                  {prompts.length > 1 || time ? (
                    <div className="mb-2 text-xs text-muted-foreground">
                      {prompts.length > 1
                        ? t('stage.generationPromptVersion', { index: index + 1, time })
                        : time}
                    </div>
                  ) : null}
                  <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                    {prompt.text}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="mt-2"
                    onClick={() => {
                      void copyPlainText(prompt.text, null).then((ok) => {
                        if (ok) setCopiedIndex(index);
                      });
                    }}
                  >
                    {copiedIndex === index ? (
                      <Check className="size-4" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                    {copiedIndex === index
                      ? t('stage.generationPromptCopied')
                      : t('stage.generationPromptCopy')}
                  </Button>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
