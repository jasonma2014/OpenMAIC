import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { generateClassroom } from '@/lib/server/classroom-generation';
import { CLASSROOMS_DIR } from '@/lib/server/classroom-storage';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { markStageGenerationComplete } from '@/lib/persistence/stage-meta';
import { importGeneratedMedia } from './generated-document';
import { runSchoolGeneration } from './generation-jobs';
import { runWithSaasOrg } from './context';
import { openSaasDb } from './db';

export async function generateSchoolLesson(stageId: string, orgId: string, baseUrl: string) {
  const db = await openSaasDb();
  await runWithSaasOrg(orgId, () =>
    runSchoolGeneration(db, stageId, async (input, onProgress) => {
      const result = await generateClassroom(input, { baseUrl, stageId, onProgress });
      const provider = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
      const base = await realpath(path.resolve(CLASSROOMS_DIR, stageId));
      const scenes = await importGeneratedMedia(result.scenes, stageId, async (url) => {
        const pathname = new URL(url, baseUrl).pathname;
        const suffix = decodeURIComponent(
          pathname.slice(`/api/classroom-media/${encodeURIComponent(stageId)}/`.length),
        );
        const filename = await realpath(path.resolve(base, suffix));
        if (!filename.startsWith(base + path.sep)) throw new Error('Invalid generated media path');
        const bytes = await readFile(filename);
        const mime: Record<string, string> = {
          '.mp3': 'audio/mpeg',
          '.wav': 'audio/wav',
          '.ogg': 'audio/ogg',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.webp': 'image/webp',
          '.mp4': 'video/mp4',
          '.webm': 'video/webm',
        };
        const contentType = mime[path.extname(filename)] ?? 'application/octet-stream';
        return provider.assetStore.put(
          { key: orgId },
          new Blob([new Uint8Array(bytes)], { type: contentType }),
          { contentType },
        );
      });
      const store = await getOwnerScopedDocumentStore(orgId);
      await store.saveDocument({
        stage: result.stage,
        scenes,
        outline: {
          outlines: [],
          requirement: input.requirement,
          producer: 'server-job',
          producerRef: stageId,
          generationComplete: true,
          createdAt: result.stage.createdAt,
          updatedAt: Date.now(),
        },
      });
      await markStageGenerationComplete(provider.pool, stageId);
    }),
  );
}
