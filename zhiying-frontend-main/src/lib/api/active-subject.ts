import type { StudySubject } from "@/lib/api/schemas";

const STATUS_PRIORITY: Record<StudySubject["status"], number> = {
  STUDYING: 0,
  PRETEST_READY: 1,
  PRETEST_QUEUING: 2,
  PRETEST_GENERATING: 2,
  PLAN_QUEUING: 2,
  PLAN_GENERATING: 2,
  FINISHED: 3,
  FAILED: 4,
};

/**
 * Resolve which subject the dashboard should focus on.
 *
 * Preference order:
 * 1. The subject whose id matches `active_study_subject_id` from /me — the
 *    user's last explicit choice (or the auto-set on creation).
 * 2. Fallback by status priority (in-progress wins) and then most recent.
 */
export function pickActiveSubject(
  activeId: number | null,
  subjects: StudySubject[],
): StudySubject | null {
  if (subjects.length === 0) return null;
  if (activeId !== null) {
    const explicit = subjects.find((s) => s.id === activeId);
    if (explicit) return explicit;
  }
  const sorted = [...subjects].sort((a, b) => {
    const p = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (p !== 0) return p;
    return b.created_at - a.created_at;
  });
  return sorted[0] ?? null;
}
