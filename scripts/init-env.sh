#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
template_path="$repo_root/.env.example"
output_path="${1:-$repo_root/.env}"

if [[ -e "$output_path" && "${FORCE:-0}" != "1" ]]; then
  echo "配置文件已存在：$output_path。若确认覆盖，请使用 FORCE=1 bash scripts/init-env.sh。" >&2
  exit 1
fi
command -v openssl >/dev/null 2>&1 || {
  echo "缺少 openssl，无法安全生成内部随机密钥。" >&2
  exit 1
}

cp "$template_path" "$output_path"

random_hex() {
  openssl rand -hex "$1"
}

set_env() {
  local name="$1"
  local value="$2"
  if ! grep -q "^${name}=" "$output_path"; then
    echo "模板缺少配置项：$name" >&2
    exit 1
  fi
  sed -i.bak "s|^${name}=.*$|${name}=${value}|" "$output_path"
}

set_env POSTGRES_PASSWORD "db-$(random_hex 18)"
set_env RABBITMQ_PASSWORD "mq-$(random_hex 18)"
set_env JWT_SECRET "$(random_hex 48)"
for name in KNOWLEDGE_EXPLANATION_API_KEY PRETEST_API_KEY PLAN_API_KEY CURRICULUM_API_KEY QUIZ_API_KEY INTERACTIVE_HTML_API_KEY KNOWLEDGE_VIDEO_API_KEY CODE_VIDEO_API_KEY RECHARGE_API_KEY; do
  set_env "$name" "sk-$(random_hex 24)"
done
set_env KNOWLEDGE_VIDEO_SERVICE_API_KEY "svc-$(random_hex 24)"
set_env CODE_VIDEO_SERVICE_API_KEY "svc-$(random_hex 24)"
set_env STORAGE_ACCESS_KEY "storage-$(random_hex 8)"
set_env STORAGE_SECRET_KEY "$(random_hex 32)"
rm -f "$output_path.bak"

echo "已生成本地配置：$output_path"
echo "请填写 LLM_BASE_URL、LLM_API_KEY、LLM_MODEL。TTS 为可选配置，默认生成无声视频。"
