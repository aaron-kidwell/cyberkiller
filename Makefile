# CyberKiller - operator Makefile.
# Targets you'll actually run by hand. Build/test workflow lives in scripts.

ROOT     := $(shell pwd)
SYSTEMD  := /etc/systemd/system
BACKUPS  := /var/backups/cyberkiller
LOGDIR   := /var/log

# Names of the unit files (sources in local/, deployed to /etc/systemd/system/)
UNITS := ck-backup.service ck-backup.timer ck-monitor.service ck-monitor.timer

.PHONY: help build deploy backup monitor install-services uninstall-services check-services logs-backup logs-monitor

help:
	@echo "CyberKiller operator targets:"
	@echo "  build               - rebuild the Go API binary"
	@echo "  deploy              - rebuild Docker images + restart control & web"
	@echo "  backup              - run a one-off backup right now"
	@echo "  monitor             - run a single health check right now"
	@echo "  install-services    - install backup + monitor systemd timers (sudo)"
	@echo "  uninstall-services  - disable + remove the timers (sudo)"
	@echo "  check-services      - show timer status + next runs"
	@echo "  logs-backup         - tail backup journal"
	@echo "  logs-monitor        - tail monitor journal"

build:
	@bash local/build-binaries.sh

deploy: build
	@docker compose -f local/docker-compose.yml up -d --build control web

backup:
	@bash local/backup.sh

monitor:
	@bash local/monitor.sh

# Install the systemd units. Idempotent: re-running re-copies + re-enables.
# Required state owned by aaron, not root, so backup/monitor scripts can write.
install-services:
	@echo "→ creating /var/backups and log files (sudo)..."
	@sudo mkdir -p $(BACKUPS)
	@sudo chown $$(whoami) $(BACKUPS)
	@sudo touch $(LOGDIR)/ck-backup.log $(LOGDIR)/ck-monitor.log
	@sudo chown $$(whoami) $(LOGDIR)/ck-backup.log $(LOGDIR)/ck-monitor.log
	@echo "→ ensuring env files exist (with 600 perms)..."
	@for f in cyberkiller-backup.env cyberkiller-monitor.env; do \
		if [ ! -f /etc/$$f ]; then \
			sudo touch /etc/$$f && sudo chmod 600 /etc/$$f; \
			echo "   created /etc/$$f (empty - add CK_ALERT_WEBHOOK= etc.)"; \
		fi; \
	done
	@echo "→ installing unit files to $(SYSTEMD)..."
	@for u in $(UNITS); do sudo install -m 644 local/$$u $(SYSTEMD)/$$u; done
	@sudo systemctl daemon-reload
	@echo "→ enabling timers..."
	@sudo systemctl enable --now ck-backup.timer ck-monitor.timer
	@echo
	@echo "✓ services installed. Next steps:"
	@echo "    1. Edit /etc/cyberkiller-monitor.env  → add CK_ALERT_WEBHOOK=https://discord.com/api/webhooks/..."
	@echo "    2. (optional) rclone config           → set up off-host backup target named 'ckbackup'"
	@echo "    3. make check-services                → confirm timers scheduled"
	@echo "    4. make backup                        → trigger a test backup"

uninstall-services:
	@echo "→ stopping + disabling timers..."
	@sudo systemctl disable --now ck-backup.timer ck-monitor.timer 2>/dev/null || true
	@echo "→ removing unit files..."
	@for u in $(UNITS); do sudo rm -f $(SYSTEMD)/$$u; done
	@sudo systemctl daemon-reload
	@echo "✓ services removed (env files + backups dir kept; rm by hand if desired)"

check-services:
	@systemctl list-timers ck-* --all
	@echo
	@systemctl status ck-backup.timer ck-monitor.timer --no-pager 2>/dev/null | grep -E 'Active|Trigger' || true

logs-backup:
	@journalctl -u ck-backup.service -n 50 --no-pager

logs-monitor:
	@journalctl -u ck-monitor.service -n 50 --no-pager
