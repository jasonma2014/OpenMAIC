import type { GenerationPrompt } from '@openmaic/dsl';

/** Keep a non-empty requirement as the first prompt record for a new course. */
export function generationPromptsFromRequirement(
  requirement: string,
  createdAt = Date.now(),
): GenerationPrompt[] | undefined {
  const text = requirement.trim();
  if (!text) return undefined;
  return [{ text, createdAt }];
}

/** Drop malformed records so an old or partial document still renders. */
export function readGenerationPrompts(value: unknown): GenerationPrompt[] {
  if (!Array.isArray(value)) return [];
  const prompts: GenerationPrompt[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { text?: unknown; createdAt?: unknown };
    if (typeof record.text !== 'string') continue;
    const text = record.text.trim();
    if (!text) continue;
    const createdAt =
      typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
        ? record.createdAt
        : 0;
    prompts.push({ text, createdAt });
  }
  return prompts;
}
