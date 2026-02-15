#!/usr/bin/env bash
# .claude/hooks/track-commit.sh
# PostToolUse hook for Bash — detects git commits and tracks changed files
# Classifies changes by significance and reminds Claude to update knowledge files

set -euo pipefail

# Read stdin (JSON with tool_input and tool_result)
INPUT=$(cat)

# Extract the bash command using grep/sed (no Python/jq dependency)
COMMAND=$(echo "$INPUT" | grep -o '"command":"[^"]*"' | head -1 | sed 's/"command":"//;s/"$//' || echo "")

# Also try the alternate JSON format where command might have escaped content
if [ -z "$COMMAND" ]; then
  COMMAND=$(echo "$INPUT" | grep -o '"command": "[^"]*"' | head -1 | sed 's/"command": "//;s/"$//' || echo "")
fi

# Only proceed if this was a git commit
if ! echo "$COMMAND" | grep -qE 'git\s+commit|git commit'; then
  exit 0
fi

# Check if the commit actually succeeded by looking at the result
RESULT=$(echo "$INPUT" | grep -o '"stdout":"[^"]*"' | head -1 || echo "")
if echo "$RESULT" | grep -qiE 'nothing to commit|no changes'; then
  exit 0
fi

# Get the files changed in the last commit
CHANGED_FILES=$(git diff --name-only HEAD~1..HEAD 2>/dev/null || echo "")
COMMIT_MSG=$(git log -1 --format="%s" 2>/dev/null || echo "")
COMMIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

if [ -z "$CHANGED_FILES" ]; then
  exit 0
fi

# --- Tier 1: Architecture-critical files ---
TIER1_PATTERNS=(
  "src/daemon/server.ts"
  "src/daemon/summarize.ts"
  "src/daemon/agent.ts"
  "src/daemon/flow-context.ts"
  "src/run/flows/url/flow.ts"
  "src/run/flows/url/summary.ts"
  "src/llm/providers/google.ts"
  "apps/chrome-extension/src/entrypoints/background.ts"
  "apps/chrome-extension/src/entrypoints/sidepanel/main.ts"
  "apps/chrome-extension/src/lib/daemon-payload.ts"
  "apps/chrome-extension/src/lib/settings.ts"
  "apps/chrome-extension/src/lib/extension-logs.ts"
  "packages/core/src/prompts/"
  "packages/core/src/shared/contracts.ts"
)

# --- Tier 2: Structural files ---
TIER2_PATTERNS=(
  "src/daemon/chat.ts"
  "src/daemon/config.ts"
  "apps/chrome-extension/src/lib/sse.ts"
  "apps/chrome-extension/src/lib/agent-response.ts"
  "apps/chrome-extension/src/entrypoints/sidepanel/panel-cache.ts"
  "apps/chrome-extension/src/entrypoints/sidepanel/pickers.tsx"
  "apps/chrome-extension/src/entrypoints/sidepanel/style.css"
  "packages/core/src/index.ts"
)

TIER1_HITS=""
TIER1_COUNT=0
TIER2_COUNT=0
TOTAL_COUNT=0

while IFS= read -r file; do
  [ -z "$file" ] && continue
  TOTAL_COUNT=$((TOTAL_COUNT + 1))

  for pattern in "${TIER1_PATTERNS[@]}"; do
    if echo "$file" | grep -qF "$pattern"; then
      TIER1_HITS="${TIER1_HITS}  - ${file}\n"
      TIER1_COUNT=$((TIER1_COUNT + 1))
      break
    fi
  done

  for pattern in "${TIER2_PATTERNS[@]}"; do
    if echo "$file" | grep -qF "$pattern"; then
      TIER2_COUNT=$((TIER2_COUNT + 1))
      break
    fi
  done
done <<< "$CHANGED_FILES"

# Check commit message for architectural keywords
MSG_SIGNIFICANT=false
if echo "$COMMIT_MSG" | grep -qiE 'refactor|breaking|architecture|rename|rewrite|restructure|migrate'; then
  MSG_SIGNIFICANT=true
fi

# Determine significance
SIGNIFICANT=false
REASON=""
if [ "$TIER1_COUNT" -gt 0 ]; then
  SIGNIFICANT=true
  REASON="Architecture-critical files changed ($TIER1_COUNT Tier-1 files)"
elif [ "$TIER2_COUNT" -ge 3 ]; then
  SIGNIFICANT=true
  REASON="Multiple structural files changed ($TIER2_COUNT Tier-2 files)"
elif [ "$TOTAL_COUNT" -ge 10 ]; then
  SIGNIFICANT=true
  REASON="Large commit ($TOTAL_COUNT files)"
elif [ "$MSG_SIGNIFICANT" = true ]; then
  SIGNIFICANT=true
  REASON="Commit message indicates architectural change"
fi

# Write tracking record
TRACK_DIR=".claude"
TRACK_FILE="$TRACK_DIR/knowledge-changes.log"
mkdir -p "$TRACK_DIR"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%SZ")

{
  echo "---"
  echo "time: $TIMESTAMP"
  echo "commit: $COMMIT_HASH"
  echo "message: $COMMIT_MSG"
  echo "significant: $SIGNIFICANT"
  echo "reason: $REASON"
  echo "total_files: $TOTAL_COUNT"
  echo "tier1: $TIER1_COUNT"
  echo "tier2: $TIER2_COUNT"
  echo "files:"
  echo "$CHANGED_FILES" | while read -r f; do [ -n "$f" ] && echo "  - $f"; done
} >> "$TRACK_FILE"

# If significant, output an immediate reminder
if [ "$SIGNIFICANT" = true ]; then
  TRUNCATED_MSG=$(echo "$COMMIT_MSG" | head -c 80)
  FILES_LIST=$(echo "$CHANGED_FILES" | head -15 | sed 's/^/  - /')
  REMAINING=$((TOTAL_COUNT - 15))

  echo "[KNOWLEDGE UPDATE NEEDED] Commit \"$TRUNCATED_MSG\" ($COMMIT_HASH) touched architecture-critical files."
  echo "Reason: $REASON"
  echo "Key files changed:"
  echo "$FILES_LIST"
  if [ "$REMAINING" -gt 0 ]; then
    echo "  ... and $REMAINING more"
  fi
  echo ""
  echo "Consider updating these knowledge files if their content is now stale:"
  echo "  - CLAUDE.md — architecture diagrams, data flows, key file paths, gotchas"
  echo "  - .claude/skills/code-architecture/SKILL.md — message types, state maps, session management, daemon routes"
  echo "  - .claude/skills/lessons-learned/SKILL.md — add any new debugging lessons or gotchas discovered"
fi
