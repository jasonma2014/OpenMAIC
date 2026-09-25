/**
 * Local SaaS acceptance walk: register → quote → real outline generation →
 * debit → publish → student join → classroom page.
 *
 * Requires: dev server on 3010, OPENMAIC_SAAS_ENABLED=true, DATABASE_URL, LLM keys in .env.local.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const base = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3010';
const stamp = Date.now();
const teacherEmail = `e2e-${stamp}@example.com`;
const studentEmail = `e2e-student-${stamp}@example.com`;
const password = `Tmp-${randomBytes(16).toString('hex')}`;

function cookies(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  return raw.map((line) => line.split(';')[0]).join('; ');
}

async function json(path, options = {}) {
  const response = await fetch(base + path, options);
  const body = await response.json().catch(() => null);
  return { status: response.status, body, cookie: cookies(response), response };
}

function psql(sql) {
  execFileSync('psql', ['-h', '127.0.0.1', '-U', 'majian', '-d', 'openmaic', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    stdio: 'pipe',
  });
}

async function consumeOutlineStream(cookie) {
  const response = await fetch(`${base}/api/generate/scene-outlines-stream`, {
    method: 'POST',
    headers: {
      cookie,
      'Content-Type': 'application/json',
      'x-image-generation-enabled': 'false',
      'x-video-generation-enabled': 'false',
    },
    body: JSON.stringify({
      requirements: {
        requirement: '用三页幻灯片向初一学生简要介绍光合作用（只讲概念，不做实验）。',
        webSearch: false,
        interactiveMode: false,
        taskEngineMode: false,
      },
      pdfText: '',
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`outline HTTP ${response.status}: ${err.slice(0, 400)}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let donePayload = null;
  let errorPayload = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const frame of parts) {
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const data = JSON.parse(line.slice(6));
        if (data.type === 'done') donePayload = data;
        if (data.type === 'error') errorPayload = data;
      }
    }
  }
  if (errorPayload) throw new Error(errorPayload.error || 'outline stream error');
  if (!donePayload?.outlines?.length) throw new Error('outline stream finished without outlines');
  return donePayload;
}

function persistMinimalCourse(orgId, stageId, title) {
  const now = Date.now();
  const sceneId = `scene-${stageId}`;
  const sceneJson = JSON.stringify({
    id: sceneId,
    type: 'slide',
    order: 1,
    title: title.slice(0, 40),
    content: { type: 'slide', canvas: { elements: [] } },
  }).replace(/'/g, "''");
  const outlineJson = JSON.stringify({
    outlines: [],
    requirement: title,
    generationComplete: true,
    createdAt: now,
    updatedAt: now,
  }).replace(/'/g, "''");
  psql(
    `INSERT INTO document_stages (id, name, created_at, updated_at, owner_id, data)
     VALUES ('${stageId}', '${title.replace(/'/g, "''").slice(0, 80)}', ${now}, ${now}, '${orgId}', '{}'::jsonb)`,
  );
  psql(
    `INSERT INTO document_scenes (stage_id, id, scene_order, data)
     VALUES ('${stageId}', '${sceneId}', 1, '${sceneJson}'::jsonb)`,
  );
  psql(`INSERT INTO document_outlines (stage_id, data) VALUES ('${stageId}', '${outlineJson}'::jsonb)`);
  psql(
    `INSERT INTO stage_meta (stage_id, owner_id, is_public, generation_complete)
     VALUES ('${stageId}', '${orgId}', false, true)
     ON CONFLICT (stage_id) DO UPDATE SET owner_id = EXCLUDED.owner_id, generation_complete = true`,
  );
}

function cleanup(orgId, stageId, emails) {
  psql(`DELETE FROM stage_meta WHERE stage_id = '${stageId}'`);
  psql(`DELETE FROM document_outlines WHERE stage_id = '${stageId}'`);
  psql(`DELETE FROM document_scenes WHERE stage_id = '${stageId}'`);
  psql(`DELETE FROM document_stages WHERE id = '${stageId}'`);
  psql(`DELETE FROM saas_sessions WHERE org_id = '${orgId}'`);
  psql(`DELETE FROM saas_classes WHERE org_id = '${orgId}'`);
  psql(`DELETE FROM saas_memberships WHERE org_id = '${orgId}'`);
  psql(`DELETE FROM saas_wallets WHERE org_id = '${orgId}'`);
  psql(`DELETE FROM saas_ledger WHERE org_id = '${orgId}'`);
  for (const email of emails) psql(`DELETE FROM saas_users WHERE email = '${email}'`);
  psql(`DELETE FROM saas_orgs WHERE id = '${orgId}'`);
}

const report = { steps: {} };

try {
  const registered = await json('/api/saas/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: teacherEmail, password, orgName: 'E2E Walk Org' }),
  });
  const orgId = registered.body?.orgId;
  const teacherCookie = registered.cookie;
  report.steps.register = { status: registered.status, orgId, signupBalance: registered.body?.balanceMilliYuan };
  if (!orgId || !teacherCookie) throw new Error('register failed');

  const quote = await json('/api/saas/quote', { headers: { cookie: teacherCookie } });
  report.steps.quote = {
    status: quote.status,
    retailMilliYuan: quote.body?.retailMilliYuan,
    balanceMilliYuan: quote.body?.balanceMilliYuan,
    sufficient: quote.body?.sufficient,
  };
  if (!quote.body?.sufficient) throw new Error('quote not sufficient');

  const before = await json('/api/saas/session', { headers: { cookie: teacherCookie } });
  const balanceBefore = before.body?.balanceMilliYuan;

  const outline = await consumeOutlineStream(teacherCookie);
  report.steps.outline = {
    outlineCount: outline.outlines.length,
    courseTitle: outline.courseTitle,
    languageDirective: outline.languageDirective?.slice(0, 40),
  };

  const after = await json('/api/saas/session', { headers: { cookie: teacherCookie } });
  const balanceAfter = after.body?.balanceMilliYuan;
  report.steps.debit = { balanceBefore, balanceAfter, debited: balanceBefore > balanceAfter };

  const stageId = `stage-e2e-${stamp}`;
  const title = outline.courseTitle || 'E2E 光合作用';
  persistMinimalCourse(orgId, stageId, title);

  const published = await json(`/api/stages/${encodeURIComponent(stageId)}/publish`, {
    method: 'POST',
    headers: { cookie: teacherCookie },
  });
  const classCode = published.body?.classCode;
  report.steps.publish = { status: published.status, classCode };

  const joined = await json('/api/saas/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: classCode, email: studentEmail, password }),
  });
  const studentCookie = joined.cookie;
  report.steps.join = {
    status: joined.status,
    role: joined.body?.role,
    stageId: joined.body?.stageId,
  };

  const studentStages = await json('/api/stages', { headers: { cookie: studentCookie } });
  const studentMeta = await json(`/api/stage-meta/${stageId}`, { headers: { cookie: studentCookie } });
  const classroom = await fetch(`${base}/classroom/${stageId}`, { headers: { cookie: studentCookie } });
  report.steps.student = {
    stagesStatus: studentStages.status,
    stageIds: studentStages.body?.stages?.map((s) => s.id),
    meta: {
      status: studentMeta.status,
      isOwner: studentMeta.body?.isOwner,
      isPublic: studentMeta.body?.isPublic,
    },
    classroomStatus: classroom.status,
  };

  cleanup(orgId, stageId, [teacherEmail, studentEmail]);
  report.ok = true;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.ok = false;
  report.error = error instanceof Error ? error.message : String(error);
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}
