/**
 * Manual regression check against the real model.
 *
 * Generates a short lesson and checks the shape only: a title, at least two
 * pages, a first page with content, and narration. Wording is not compared.
 *
 * Not part of `pnpm test` or CI. Run it by hand:
 *
 *   pnpm test:live-lesson
 *
 * Reads `.env.local` for DEFAULT_MODEL and the provider key. Shell variables
 * already set win over the file. The key is never printed.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

import type { AICallFn } from '@openmaic/generation';
import type { Action } from '@openmaic/dsl';

const REQUIREMENT =
  '用两页给小学三年级讲什么是分数。第一页讲把一个东西平均分成几份、取其中的几份。第二页出一道选择题。';

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function loadLocalEnv(): void {
  const envPath = resolve(process.cwd(), '.env.local');
  let content: string;
  try {
    content = readFileSync(envPath, 'utf-8');
  } catch {
    return;
  }
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!key || process.env[key]) continue;
    process.env[key] = unquote(trimmed.slice(eqIdx + 1).trim());
  }
}

function narrationOf(actions: Action[]): string {
  return actions
    .filter(
      (action): action is Action & { type: 'speech'; text: string } =>
        action.type === 'speech' && typeof action.text === 'string',
    )
    .map((action) => action.text.trim())
    .filter(Boolean)
    .join('\n');
}

function contentHasBody(content: unknown): boolean {
  if (!content || typeof content !== 'object') return false;
  const value = content as { elements?: unknown; questions?: unknown; html?: unknown };
  if (Array.isArray(value.elements) && value.elements.length > 0) return true;
  if (Array.isArray(value.questions) && value.questions.length > 0) return true;
  if (typeof value.html === 'string' && value.html.trim().length > 0) return true;
  return false;
}

function fail(message: string): never {
  console.error(`没有通过：${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  loadLocalEnv();
  if (!process.env.DEFAULT_MODEL?.trim()) {
    fail('没有 DEFAULT_MODEL。把它写在 .env.local 里再跑。');
  }

  const { callLLM } = await import('@/lib/ai/llm');
  const { resolveModel } = await import('@/lib/server/resolve-model');
  const {
    applyOutlineFallbacks,
    generateSceneActions,
    generateSceneContent,
    generateSceneOutlinesFromRequirements,
  } = await import('@openmaic/generation');

  const outlineModel = await resolveModel({ stage: 'scene-outlines-stream' });
  const actionsModel = await resolveModel({ stage: 'scene-actions' });

  const callFor = (
    resolved: Awaited<ReturnType<typeof resolveModel>>,
    source: string,
  ): AICallFn => {
    return async (systemPrompt, userPrompt) => {
      const result = await callLLM(
        {
          model: resolved.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          maxOutputTokens: resolved.modelInfo?.outputWindow,
          maxRetries: 0,
        },
        source,
        undefined,
        resolved.thinkingConfig,
      );
      return result.text;
    };
  };

  console.log(`模型：${outlineModel.modelString}`);
  console.log('正在写大纲…');
  const started = Date.now();
  const outlined = await generateSceneOutlinesFromRequirements(
    { requirement: REQUIREMENT },
    undefined,
    undefined,
    callFor(outlineModel, 'live-lesson-outline'),
  );
  if (!outlined.success || !outlined.data || outlined.data.outlines.length < 2) {
    fail(outlined.error || '大纲没有写出至少两页。');
  }
  const { courseTitle, languageDirective, outlines } = outlined.data;
  const titled = outlines.every((outline) => outline.title.trim().length > 0);
  if (!titled) fail('有一页没有标题。');

  const first = applyOutlineFallbacks(outlines[0]!, true);
  const contentStage =
    first.type === 'slide' ||
    first.type === 'quiz' ||
    first.type === 'interactive' ||
    first.type === 'pbl'
      ? (`scene-content:${first.type}` as const)
      : 'scene-content';
  const contentModel = await resolveModel({ stage: contentStage });
  console.log(`课名：${courseTitle?.trim() || first.title}`);
  console.log(`页数：${outlines.length}`);
  for (const [index, outline] of outlines.entries()) {
    console.log(`  ${index + 1}. ${outline.title}`);
  }

  console.log('正在写第一页和讲解…');
  const content = await generateSceneContent(first, callFor(contentModel, 'live-lesson-content'), {
    languageDirective,
    userRequirements: { requirement: REQUIREMENT },
  });
  if (!contentHasBody(content)) fail('第一页没有内容。');

  const actions = await generateSceneActions(
    first,
    content!,
    callFor(actionsModel, 'live-lesson-actions'),
    { languageDirective },
  );
  const narration = narrationOf(actions);
  if (narration.length < 8) fail('第一页没有讲解。');

  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`讲解：${narration.slice(0, 80)}${narration.length > 80 ? '…' : ''}`);
  console.log(`通过，用时 ${seconds} 秒。`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`没有通过：${message}`);
  process.exit(1);
});
