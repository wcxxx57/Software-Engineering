# Start all middleware and block until long-running services are healthy.
# minio-init runs once and exits; it's intentionally excluded from --wait
# (which treats clean exits as failure).
serve:
  @docker compose up -d --wait postgres rabbitmq minio \
    && printf '\033[32m✔\033[0m zhiying-infra \033[32mReady\033[0m\n' \
    || (printf '\033[31m✗\033[0m zhiying-infra \033[31mFailed\033[0m\n'; exit 1)

# Tear down containers (named volumes preserved).
stop:
  @if [ -n "$(docker compose ps -q)" ]; then \
     docker compose down \
       && printf '\033[32m✔\033[0m zhiying-infra \033[32mStopped\033[0m\n'; \
   fi

log:
  @docker compose logs -f

# Tear down containers AND remove the named volumes (postgres + rabbitmq state).
reset:
  @docker compose down -v \
    && printf '\033[32m✔\033[0m zhiying-infra \033[32mReset\033[0m\n'
