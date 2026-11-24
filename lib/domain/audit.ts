import type { Tx } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";

export type AuditInput = {
  staffId: number | null;
  action: string;
  entity: string;
  entityId: string | number | null;
  before?: unknown;
  after?: unknown;
};

/**
 * Every admin write lands here. Passed the transaction so a failed audit
 * write rolls the whole change back — no silent state changes.
 */
export async function writeAudit(tx: Tx, input: AuditInput) {
  await tx.insert(auditLog).values({
    staffId: input.staffId,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId === null ? null : String(input.entityId),
    before: input.before ?? null,
    after: input.after ?? null,
  });
}
