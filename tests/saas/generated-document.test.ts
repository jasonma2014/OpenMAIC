import { expect, it } from 'vitest';
import { importGeneratedMedia } from '@/lib/saas/generated-document';

it('stores generated narration and images as school-owned assets without keeping transport audio URLs', async () => {
  const input = {
    scenes: [
      {
        actions: [
          {
            type: 'speech',
            text: '你好',
            audioId: 'old-audio',
            audioUrl: 'http://localhost/api/classroom-media/lesson-1/audio/a.mp3',
          },
        ],
        content: { src: 'http://localhost/api/classroom-media/lesson-1/media/p.png' },
      },
    ],
  };
  const imported = await importGeneratedMedia(input, 'lesson-1', async (url) =>
    url.endsWith('.mp3') ? 'asset-audio' : 'asset-image',
  );
  expect(imported).toEqual({
    scenes: [
      {
        actions: [{ type: 'speech', text: '你好', audioId: 'asset-audio' }],
        content: { src: 'asset-image' },
      },
    ],
  });
  expect(input.scenes[0].actions[0].audioId).toBe('old-audio');
});
