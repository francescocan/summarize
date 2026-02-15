#!/usr/bin/env bash
# .claude/hooks/check-knowledge-staleness.sh
# PreCompact hook — reminds Claude to update knowledge files before context is lost

set -euo pipefail

TRACK_FILE=".claude/knowledge-changes.log"

# If no tracking file, nothing to report
if [ ! -f "$TRACK_FILE" ]; then
  exit 0
fi

# Count significant entries
SIG_COUNT=$(grep -c "^significant: true" "$TRACK_FILE" 2>/dev/null || echo "0")

if [ "$SIG_COUNT" -eq 0 ]; then
  exit 0
fi

# Extract significant commit messages
SIG_COMMITS=""
while IFS= read -r line; do
  SIG_COMMITS="${SIG_COMMITS}  - ${line}\n"
done < <(grep -A1 "^significant: true" "$TRACK_FILE" 2>/dev/null | grep "^commit:" | sed 's/^commit: //' | sort -u)

# Extract all files from significant sections
# Simple approach: get all file lines after "significant: true" blocks
SIG_FILES=""
IN_SIG=false
while IFS= read -r line; do
  if echo "$line" | grep -q "^significant: true"; then
    IN_SIG=true
    continue
  fi
  if echo "$line" | grep -q "^---"; then
    IN_SIG=false
    continue
  fi
  if [ "$IN_SIG" = true ] && echo "$line" | grep -q "^  - "; then
    SIG_FILES="${SIG_FILES}${line}\n"
  fi
done < "$TRACK_FILE"

# Deduplicate files
UNIQUE_FILES=$(echo -e "$SIG_FILES" | sort -u | grep -v '^$')

echo "[CONTEXT COMPACTION — KNOWLEDGE UPDATE CHECK]"
echo "Before context is compacted, review $SIG_COUNT significant commit(s) from this session."
echo ""
echo "Architecture-critical files that changed:"
echo "$UNIQUE_FILES" | head -20
echo ""
echo "Please check and update these knowledge files if their content is now stale:"
echo "  1. CLAUDE.md — Project context, architecture diagrams, data flows, key file paths, gotchas"
echo "  2. .claude/skills/code-architecture/SKILL.md — Message types, state maps, functions, daemon routes"
echo "  3. .claude/skills/lessons-learned/SKILL.md — Add any new debugging lessons discovered"
echo ""
echo "After updating, you can clear the tracking log by deleting .claude/knowledge-changes.log"
