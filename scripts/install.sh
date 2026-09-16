#!/usr/bin/env bash
# One-shot installer for a fresh Ubuntu server. Run as root:
#   curl -fsSL https://raw.githubusercontent.com/avivagami/personal-assistant/claude/ready-to-code-okjjiy/scripts/install.sh | bash
# It asks for each setting, writes /opt/assistant/.env, and starts the bot.
set -euo pipefail

REPO="https://github.com/avivagami/personal-assistant.git"
DIR="/opt/assistant"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ask() { # ask VAR "prompt" [default]
  local var="$1" prompt="$2" def="${3:-}" val
  while true; do
    if [ -n "$def" ]; then read -r -p "$prompt [$def]: " val </dev/tty; val="${val:-$def}"; else read -r -p "$prompt: " val </dev/tty; fi
    [ -n "$val" ] && break
    echo "  (this one is required)"
  done
  printf -v "$var" '%s' "$val"
}

[ "$(id -u)" -eq 0 ] || { echo "Run this as root (log in as root@YOUR_SERVER_IP)."; exit 1; }

say "1/5 Firewall and basics"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ufw git curl openssl >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw --force enable >/dev/null
echo "  Firewall on: only SSH is open. The bot needs no open port."

say "2/5 Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh >/dev/null 2>&1
fi
echo "  Docker $(docker --version | cut -d' ' -f3 | tr -d ,)"

say "3/5 Getting the code"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull -q; else git clone -q "$REPO" "$DIR"; fi
cd "$DIR"

say "4/5 Your settings"
echo "  Paste each value and press Enter. Nothing is shown to anyone else."
if [ -f .env ]; then
  read -r -p "  A .env already exists. Keep it? [Y/n]: " keep </dev/tty
  if [[ "${keep:-Y}" =~ ^[Yy]$ ]]; then SKIP_ENV=1; fi
fi
if [ -z "${SKIP_ENV:-}" ]; then
  ask TELEGRAM_BOT_TOKEN      "Telegram bot token (from BotFather)"
  ask TELEGRAM_OWNER_ID       "Your Telegram user id (from userinfobot)"
  ask ANTHROPIC_API_KEY       "Anthropic API key (sk-ant-...)"
  ask SUPABASE_URL            "Supabase Project URL (https://....supabase.co)"
  ask SUPABASE_SERVICE_ROLE_KEY "Supabase service_role key"
  ask GOOGLE_CLIENT_ID        "Google OAuth Client ID"
  ask GOOGLE_CLIENT_SECRET    "Google OAuth Client secret"
  ask OWNER_NAME              "Your first name" "Aviva"
  ask TIMEZONE                "Timezone" "Asia/Jerusalem"
  TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 32)"
  cat > .env <<ENV
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
TELEGRAM_OWNER_ID=$TELEGRAM_OWNER_ID
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
ANTHROPIC_MODEL=claude-opus-5
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET
TOKEN_ENCRYPTION_KEY=$TOKEN_ENCRYPTION_KEY
TIMEZONE=$TIMEZONE
OWNER_NAME=$OWNER_NAME
PROACTIVE_ENABLED=true
PROACTIVE_INTERVAL_MINUTES=15
MORNING_BRIEF_TIME=07:30
DROPPED_THREADS_TIME=17:00
AUDIT_RETENTION_DAYS=90
CHAT_RETENTION_DAYS=30
APPROVAL_TTL_HOURS=24
ENV
  chmod 600 .env
  echo "  Saved to $DIR/.env (readable by root only). Encryption key generated."
fi

say "5/5 Starting"
docker compose up -d --build 2>&1 | tail -3
sleep 6
if docker compose logs --tail 20 2>/dev/null | grep -q "is listening"; then
  echo
  echo "  Running. Open your bot in Telegram and send /start, then /connect."
else
  echo
  echo "  It started but did not confirm yet. Check with:"
  echo "    docker compose -f $DIR/docker-compose.yml logs --tail 50"
fi
