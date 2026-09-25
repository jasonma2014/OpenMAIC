import { describe, expect, it } from 'vitest';

import {
  stagesVisibleToRole,
  tightenStudentAccess,
  viewerOwnsCourse,
} from '@/lib/saas/student-access';
import { visibleSettingsSection } from '@/lib/saas/settings-sections';
import { formatBalanceYuan, parseSaasSession } from '@/lib/saas/session-state';

const draft = { ownerId: 'org-1', isPublic: false };
const published = { ownerId: 'org-1', isPublic: true };

describe('student course access', () => {
  it('lets a student read only their organization published course', () => {
    expect(tightenStudentAccess({ kind: 'read', stageId: 's' }, 'allow', published, 'org-1')).toBe(
      'allow',
    );
    expect(tightenStudentAccess({ kind: 'read', stageId: 's' }, 'allow', draft, 'org-1')).toBe(
      'forbid',
    );
    expect(
      tightenStudentAccess({ kind: 'read', stageId: 's' }, 'allow', published, 'other-org'),
    ).toBe('forbid');
    expect(tightenStudentAccess({ kind: 'write', stageId: 's' }, 'allow', published, 'org-1')).toBe(
      'forbid',
    );
    expect(tightenStudentAccess({ kind: 'create', stageId: 's' }, 'allow', null, 'org-1')).toBe(
      'forbid',
    );
    expect(
      tightenStudentAccess({ kind: 'delete', stageId: 's' }, 'allow', published, 'org-1'),
    ).toBe('forbid');
  });

  it('keeps edit rights with teachers and published courses with students', () => {
    expect(viewerOwnsCourse(true, 'teacher')).toBe(true);
    expect(viewerOwnsCourse(true, 'org_admin')).toBe(true);
    expect(viewerOwnsCourse(true, undefined)).toBe(true);
    expect(viewerOwnsCourse(true, 'student')).toBe(false);
    expect(viewerOwnsCourse(false, 'teacher')).toBe(false);

    const stages = [{ id: 'draft' }, { id: 'live' }];
    expect(stagesVisibleToRole(stages, 'teacher', new Set(['live']))).toEqual(stages);
    expect(stagesVisibleToRole(stages, 'student', new Set(['live']))).toEqual([{ id: 'live' }]);
  });

  it('hides provider settings and reads a session body', () => {
    expect(visibleSettingsSection('providers', true)).toBe('general');
    expect(visibleSettingsSection('skills', true)).toBe('skills');
    expect(visibleSettingsSection('providers', false)).toBe('providers');
    expect(formatBalanceYuan(2500)).toBe('2.50');
    expect(
      parseSaasSession(200, {
        userId: 'u',
        email: 'a@b.co',
        orgId: 'o',
        orgName: '学校',
        role: 'teacher',
        balanceMilliYuan: 2500,
      }).status,
    ).toBe('signed-in');
    expect(parseSaasSession(401, {}).status).toBe('signed-out');
    expect(parseSaasSession(404, {}).status).toBe('off');
  });
});
