'use client';

import { useI18n } from '@/lib/hooks/use-i18n';

const STEPS = [1, 2, 3, 4] as const;

/** Teacher-facing path from a lesson idea to a class code. */
export function GenerationGuide({ priced }: { priced: boolean }) {
  const { t } = useI18n();
  const steps = STEPS.filter((step) => priced || step !== 2);
  return (
    <section className="mt-8 w-full text-left" aria-labelledby="generation-guide-title">
      <h2 id="generation-guide-title" className="mb-3 text-sm font-medium text-foreground/80">
        {t('home.guideTitle')}
      </h2>
      <ol className="grid gap-3 sm:grid-cols-2">
        {steps.map((step, index) => (
          <li key={step} className="rounded-xl border border-border/60 bg-background/70 px-3 py-3">
            <p className="text-sm font-medium">
              <span className="mr-2 tabular-nums text-muted-foreground">{index + 1}</span>
              {t(`home.guideStep${step}Title`)}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t(`home.guideStep${step}Body`)}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
