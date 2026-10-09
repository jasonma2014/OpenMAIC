/** Import the generator's local transport URLs into the school's asset store. */
export async function importGeneratedMedia<T>(
  value: T,
  stageId: string,
  ingest: (url: string) => Promise<string>,
): Promise<T> {
  const prefix = `/api/classroom-media/${encodeURIComponent(stageId)}/`;
  const imported = new Map<string, Promise<string>>();
  const isGenerated = (value: unknown): value is string => {
    if (typeof value !== 'string') return false;
    try {
      return new URL(value, 'http://local').pathname.startsWith(prefix);
    } catch {
      return false;
    }
  };
  const asset = (url: string) => {
    let pending = imported.get(url);
    if (!pending) {
      pending = ingest(url);
      imported.set(url, pending);
    }
    return pending;
  };
  async function visit(node: unknown): Promise<unknown> {
    if (isGenerated(node)) return asset(node);
    if (Array.isArray(node)) return Promise.all(node.map(visit));
    if (!node || typeof node !== 'object') return node;
    const record = node as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record)) {
      if (key === 'audioUrl' && record.type === 'speech' && isGenerated(entry)) continue;
      result[key] = await visit(entry);
    }
    if (record.type === 'speech' && isGenerated(record.audioUrl))
      result.audioId = await asset(record.audioUrl);
    return result;
  }
  return (await visit(value)) as T;
}
