#!/usr/bin/env bash
set -euo pipefail

REQUIREMENTS="${1:-$(dirname "$0")/requirements.txt}"

if [[ ! -f "$REQUIREMENTS" ]]; then
  echo "ERROR: requirements file not found: $REQUIREMENTS" >&2
  exit 1
fi

echo "Checking for updates: $REQUIREMENTS"
echo ""
printf "%-40s %-15s %-15s %s\n" "Package" "Current" "Latest" "Status"
printf "%-40s %-15s %-15s %s\n" "-------" "-------" "------" "------"

has_updates=0

while IFS= read -r line || [[ -n "$line" ]]; do
  # Skip blank lines and comments
  [[ -z "$line" || "$line" == \#* ]] && continue

  # Strip extras like [standard]
  pkg_raw="${line%%[*}"
  pkg_raw="${pkg_raw%%#*}"
  pkg_raw="${pkg_raw%"${pkg_raw##*[![:space:]]}"}"  # trim trailing whitespace

  # Split on == (pinned) or >= or ~=
  if [[ "$pkg_raw" =~ ^([A-Za-z0-9_.-]+)[=~><!]+(.+)$ ]]; then
    pkg_name="${BASH_REMATCH[1]}"
    current_version="${BASH_REMATCH[2]}"
  else
    pkg_name="$pkg_raw"
    current_version="(unpinned)"
  fi

  # Query PyPI for the latest version
  latest=$(curl -sf "https://pypi.org/pypi/${pkg_name}/json" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['info']['version'])" 2>/dev/null \
    || echo "ERROR")

  if [[ "$latest" == "ERROR" ]]; then
    status="fetch failed"
  elif [[ "$current_version" == "$latest" ]]; then
    status="up to date"
  else
    status="UPDATE AVAILABLE"
    has_updates=1
  fi

  printf "%-40s %-15s %-15s %s\n" "$pkg_name" "$current_version" "$latest" "$status"

done < "$REQUIREMENTS"

echo ""
if [[ "$has_updates" -eq 1 ]]; then
  echo "Updates are available."
  exit 1
else
  echo "All packages are up to date."
  exit 0
fi
