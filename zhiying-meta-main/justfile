repo_base := "git@github.com:zhiying-tutor"
sub_repos := "zhiying-infra zhiying-backend zhiying-mocks zhiying-frontend zhiying-ui"

mod zhiying-infra
mod zhiying-backend
mod zhiying-mocks
mod zhiying-frontend
mod zhiying-ui

default:
  @just --list

# Clone every sibling repo that is missing. Idempotent — existing checkouts are left alone.
bootstrap:
  #!/usr/bin/env bash
  set -euo pipefail
  for repo in {{sub_repos}}; do
    if [ -d "$repo/.git" ]; then
      echo "skip $repo (already cloned)"
    else
      echo "cloning $repo"
      git clone "{{repo_base}}/$repo.git" "$repo"
    fi
  done

# Fast-forward every sibling repo. Untracked / dirty trees are skipped with a warning.
sync:
  #!/usr/bin/env bash
  set -uo pipefail
  for repo in {{sub_repos}}; do
    if [ ! -d "$repo/.git" ]; then
      echo "skip $repo (not cloned; run \`just bootstrap\`)"
      continue
    fi
    echo "--- $repo ---"
    git -C "$repo" pull --ff-only || echo "warn: $repo could not fast-forward"
  done

# Show short status across every sibling repo.
status:
  #!/usr/bin/env bash
  for repo in {{sub_repos}}; do
    if [ -d "$repo/.git" ]; then
      echo "--- $repo ($(git -C "$repo" rev-parse --abbrev-ref HEAD)) ---"
      git -C "$repo" status -s
    fi
  done

# Bring the whole local stack up (infra → backend → mocks → frontend).
# Backend is built up-front so all the cargo output stays at the top
# rather than getting interleaved with the per-service ✔ lines.
up:
  just zhiying-backend build
  just zhiying-infra serve
  just zhiying-backend serve
  just zhiying-mocks serve
  just zhiying-frontend serve

# Stop everything in reverse order. Errors tolerated so partial states clean up.
down:
  -just zhiying-frontend stop
  -just zhiying-mocks stop
  -just zhiying-backend stop
  -just zhiying-infra stop

# Show what is currently running.
ps:
  @echo "--- tmux sessions ---"
  -@tmux ls 2>/dev/null
  @echo "--- docker compose (zhiying-infra) ---"
  -@cd zhiying-infra && docker compose ps

# Wipe local persistent state: docker volumes + backend SQLite file.
# Depends on down so frontend / mocks aren't left talking to gone services.
reset: down
  just zhiying-infra reset
  just zhiying-backend reset

# Remove build artifacts across all subrepos (cargo target, .next, py caches).
clean:
  just zhiying-backend clean
  just zhiying-frontend clean
  just zhiying-mocks clean
