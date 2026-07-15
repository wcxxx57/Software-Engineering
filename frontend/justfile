session := "zhiying-frontend"
health_url := "http://localhost:3000/health"

# Spawn pnpm dev in tmux, block on /health.
serve:
  @tmux has-session -t {{session}} 2>/dev/null || tmux new -d -s {{session}} 'pnpm dev'
  @just wait

# Block until /health responds 200, or fail after 60s.
wait:
  @timeout 60 bash -c 'until curl -sf {{health_url}} >/dev/null 2>&1; do sleep 0.5; done' \
    && printf '\033[32m✔\033[0m zhiying-frontend \033[32mReady\033[0m\n' \
    || (printf '\033[31m✗\033[0m zhiying-frontend \033[31mFailed\033[0m\n'; exit 1)

# Kill the tmux session running pnpm dev.
stop:
  @if tmux has-session -t {{session}} 2>/dev/null; then \
     tmux kill-session -t {{session}}; \
     printf '\033[32m✔\033[0m zhiying-frontend \033[32mStopped\033[0m\n'; \
   fi

log:
  @tmux attach -t {{session}}

typecheck:
  pnpm exec tsc --noEmit

# Remove Next.js build artifacts and node_modules cache.
clean:
  @rm -rf .next node_modules/.cache \
    && printf '\033[32m✔\033[0m zhiying-frontend \033[32mCleaned\033[0m\n'
