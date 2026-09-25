import { registerFromBody } from '@/lib/saas/http';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  return registerFromBody(body);
}
