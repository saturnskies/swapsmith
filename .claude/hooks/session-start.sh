#!/bin/bash
# Cloud sessions start in a fresh container: install the Superpowers plugin
# (the project's workflow backbone, enabled in .claude/settings.json).
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

plugin="superpowers@claude-plugins-official"
installed="$HOME/.claude/plugins/installed_plugins.json"

# Idempotent: skip when already installed
if grep -q "\"$plugin\"" "$installed" 2>/dev/null; then
  exit 0
fi

# A fresh container's copy of the marketplace can be out of date and not list the plugin yet
# ("Plugin not found in marketplace", seen 2026-11-12); refresh it first. A failed refresh is not fatal.
claude plugin marketplace update claude-plugins-official || true
claude plugin install "$plugin"
