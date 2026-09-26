import { describe, expect, it } from 'vitest';

import {
  generationPromptsFromRequirement,
  readGenerationPrompts,
} from '@/lib/classroom/generation-prompt';

describe('generation prompts', () => {
  it('keeps the trimmed requirement with the course version', () => {
    expect(generationPromptsFromRequirement('  三年级语文《灰雀》  ', 10)).toEqual([
      { text: '三年级语文《灰雀》', createdAt: 10 },
    ]);
  });

  it('drops a blank requirement', () => {
    expect(generationPromptsFromRequirement('   ')).toBeUndefined();
  });

  it('reads only complete prompt records', () => {
    expect(
      readGenerationPrompts([
        { text: '  光的反射  ', createdAt: 20 },
        { text: '   ', createdAt: 30 },
        { createdAt: 40 },
        null,
        { text: '分数', createdAt: Number.NaN },
      ]),
    ).toEqual([
      { text: '光的反射', createdAt: 20 },
      { text: '分数', createdAt: 0 },
    ]);
  });
});
