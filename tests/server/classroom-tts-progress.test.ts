import { expect, it, vi } from 'vitest';
import type { Scene } from '@/lib/types/stage';
import { generateTTSForClassroom } from '@/lib/server/classroom-media-generation';

vi.mock('fs', async (original) => {
  const fs = await original<typeof import('fs')>();
  return { ...fs, promises: { ...fs.promises, mkdir: vi.fn(), writeFile: vi.fn() } };
});
vi.mock('@/lib/server/provider-config', async (original) => ({
  ...(await original<typeof import('@/lib/server/provider-config')>()),
  getServerTTSProviders: () => ({ openai: { disabled: false } }),
  resolveTTSApiKey: () => 'test-key',
  resolveTTSBaseUrl: () => undefined,
}));
vi.mock('@/lib/audio/tts-providers', () => ({
  generateTTS: vi
    .fn()
    .mockResolvedValueOnce({ audio: Buffer.from('audio'), format: 'mp3' })
    .mockRejectedValueOnce(new Error('provider unavailable')),
}));

it('reports every narration processed and distinguishes provider failures', async () => {
  const scenes: Scene[] = [
    {
      id: 'scene',
      stageId: 'lesson',
      title: '练习',
      order: 0,
      type: 'quiz',
      content: { type: 'quiz', questions: [] },
      actions: [
        { id: 'a1', type: 'speech', text: '一加一等于二。' },
        { id: 'a2', type: 'speech', text: '下面开始练习。' },
      ],
    },
  ];
  const onProgress = vi.fn();
  await generateTTSForClassroom(scenes, 'lesson', 'http://localhost', onProgress);
  expect(onProgress.mock.calls.map(([item]) => item)).toEqual([
    { completed: 0, total: 2, failed: 0 },
    { completed: 1, total: 2, failed: 0 },
    { completed: 2, total: 2, failed: 1 },
  ]);
  expect(scenes[0].actions?.[0]).toHaveProperty('audioId');
  expect(scenes[0].actions?.[1]).not.toHaveProperty('audioId');
});
