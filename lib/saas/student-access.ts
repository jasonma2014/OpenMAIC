import type { DocumentAccess, DocumentAction } from '@/lib/persistence/document-access';
import type { SaasRole } from '@/lib/saas/roles';

/**
 * Students may only read a published course that belongs to their organization.
 * Drafts and every write stay with teachers.
 */
export function tightenStudentAccess(
  action: DocumentAction,
  access: DocumentAccess,
  meta: { ownerId: string; isPublic: boolean } | null,
  ownerId: string,
): DocumentAccess {
  if (action.kind === 'write' || action.kind === 'create' || action.kind === 'delete') {
    return 'forbid';
  }
  if (action.kind === 'read' && access === 'allow') {
    if (!meta?.isPublic || meta.ownerId !== ownerId) return 'forbid';
  }
  return access;
}

/** A student shares the organization id but cannot edit or publish. */
export function viewerOwnsCourse(ownerMatches: boolean, role: SaasRole | undefined): boolean {
  return ownerMatches && role !== 'student';
}

/** Students see published courses only. Teachers and admins see the whole org library. */
export function stagesVisibleToRole<T extends { id: string }>(
  stages: readonly T[],
  role: SaasRole | undefined,
  publicStageIds: ReadonlySet<string>,
): T[] {
  if (role !== 'student') return [...stages];
  return stages.filter((stage) => publicStageIds.has(stage.id));
}
