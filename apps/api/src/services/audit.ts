// Rejestr zmian (4.11) i dziennik zmian klientki (3: „Klientki – dziennik zmian”).
// Zapisujemy kto, co i kiedy zmienił – bez treści zdrowotnych.
import { id, nowIso } from '../db.ts';
import type { StudioScope } from '../scope.ts';

export function audit(
  scope: StudioScope,
  input: { actorId: string | null; action: string; entity: string; entityId?: string | null; subjectUserId?: string | null; details?: Record<string, unknown> },
) {
  scope.run(
    `INSERT INTO audit_log (id, studio_id, actor_id, action, entity, entity_id, subject_user_id, details_json, created_at)
     VALUES ($id, $studio, $actor, $action, $entity, $eid, $subject, $details, $now)`,
    {
      id: id(),
      actor: input.actorId,
      action: input.action,
      entity: input.entity,
      eid: input.entityId ?? null,
      subject: input.subjectUserId ?? null,
      details: input.details ? JSON.stringify(input.details) : null,
      now: nowIso(),
    },
  );
}
