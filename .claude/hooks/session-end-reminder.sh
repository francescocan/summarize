#!/usr/bin/env bash
# .claude/hooks/session-end-reminder.sh
# SessionEnd hook — final safety net reminder about knowledge file updates

set -euo pipefail

TRACK_FILE=".claude/knowledge-changes.log"

# If no tracking file, nothing to report
if [ ! -f "$TRACK_FILE" ]; then
  exit 0
fi

# Count significant entries
SIG_COUNT=$(grep -c "^significant: true" "$TRACK_FILE" 2>/dev/null || echo "0")

if [ "$SIG_COUNT" -eq 0 ]; then
  # Clean up if nothing significant
  rm -f "$TRACK_FILE"
  exit 0
fi

echo "[SESSION ENDING — KNOWLEDGE FILES MAY BE STALE]"
echo "This session had $SIG_COUNT significant commit(s) that may have outdated the project knowledge files."
echo "Next session should review CLAUDE.md and .claude/skills/ for accuracy."

# Do NOT clear the tracking file — persist for the next session to pick up
