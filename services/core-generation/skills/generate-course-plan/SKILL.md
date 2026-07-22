---
name: generate-course-plan
description: Generate a personalized staged learning plan from a published authoritative curriculum tree and learner evidence. Use when the core-generation plan worker must convert a pinned curriculum version, pretest results, learner profile, and learning history into tasks with valid knowledge-node mappings.
---

# Generate Course Plan

## Workflow

1. Treat the supplied curriculum tree as the only knowledge authority.
2. Diagnose weak nodes from wrong, unanswered, or low-confidence pretest results and prior weak-node history.
3. Preserve the curriculum hierarchy and order while prioritizing weak prerequisites.
4. Generate exactly the requested stage count and exactly the configured task count per stage.
5. Map every task to one or more supplied `node_key` values.

## Constraints

- Never invent, rename, or emit a knowledge-node key that is absent from the input.
- Keep tasks executable and specific; describe an observable learning outcome or practice activity.
- Compress already-mastered material, but retain foundations needed by later nodes.
- Return JSON only. Let the runtime schema define the exact wire format.
