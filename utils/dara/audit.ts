import { prismaAdmin } from '@/utils/prisma';

// DARA-013: append-only audit trail (NIST AU-2/AU-3/AU-12). Records who did what,
// to which entity, in which company, and when. Written via the privileged client
// (the dara_audit_log table grants SELECT/INSERT to dara_admin only — append-only,
// no app-role access). recordAudit never throws into the caller: a failed audit
// write is logged but must not break the user action.

export interface AuditEntry {
  action: string; // e.g. 'document.upload', 'company.update', 'evaluation.run'
  companyId?: bigint | null;
  actorId?: string | null;
  actorEmail?: string | null;
  entityType?: string;
  entityId?: string | number | bigint | null;
  metadata?: Record<string, unknown> | null;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prismaAdmin.auditLog.create({
      data: {
        action: entry.action,
        companyId: entry.companyId ?? null,
        actorId: entry.actorId ?? null,
        actorEmail: entry.actorEmail ?? '',
        entityType: entry.entityType ?? '',
        entityId: entry.entityId != null ? String(entry.entityId) : null,
        metadata: (entry.metadata ?? undefined) as never
      }
    });
  } catch (e) {
    console.error(`[audit] failed to record "${entry.action}":`, e);
  }
}
