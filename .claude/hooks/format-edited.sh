#!/usr/bin/env bash
# Formats a file right after it is edited, so formatting never shows up as
# review noise in the diff.
#
# Deliberately best-effort: this runs after every edit, and a formatter that is
# missing or unhappy must never block the work. Always exits 0.

set -uo pipefail

payload=$(cat)

file_path=$(printf '%s' "$payload" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
value = (data.get('tool_input') or {}).get('file_path')
if value:
    print(value)
" 2>/dev/null || true)

[ -n "$file_path" ] || exit 0
[ -f "$file_path" ] || exit 0

case "$file_path" in
  *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.json | *.css | *.md | *.yml | *.yaml) ;;
  *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
[ -d node_modules ] || exit 0

npx --no-install prettier --write "$file_path" >/dev/null 2>&1 || true

# Guarded on the config so this stays a no-op in a checkout that has not
# configured ESLint yet.
if [ -f eslint.config.js ] || [ -f eslint.config.mjs ]; then
  npx --no-install eslint --fix "$file_path" >/dev/null 2>&1 || true
fi

exit 0
