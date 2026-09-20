#!/usr/bin/env bash
# One-time: installs the hourly auto-update timer on the server. Run as root.
set -euo pipefail
cat > /etc/systemd/system/assistant-update.service <<'UNIT'
[Unit]
Description=Update the personal assistant from GitHub if it changed
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/opt/assistant/scripts/auto-update.sh
StandardOutput=append:/var/log/assistant-update.log
StandardError=append:/var/log/assistant-update.log
UNIT
cat > /etc/systemd/system/assistant-update.timer <<'UNIT'
[Unit]
Description=Hourly check for assistant updates

[Timer]
OnBootSec=3min
OnUnitActiveSec=1h
RandomizedDelaySec=5min
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now assistant-update.timer
echo "Auto-update enabled. Next runs:"
systemctl list-timers assistant-update.timer --no-pager | head -3
