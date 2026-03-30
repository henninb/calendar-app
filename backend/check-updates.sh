#!/bin/sh
set -eu

DO_UPDATE=0
REQUIREMENTS=""

for arg in "$@"; do
  case "$arg" in
    -u|--update) DO_UPDATE=1 ;;
    *) REQUIREMENTS="$arg" ;;
  esac
done

REQUIREMENTS="${REQUIREMENTS:-$(dirname "$0")/requirements.txt}"

if [ ! -f "$REQUIREMENTS" ]; then
  echo "ERROR: requirements file not found: $REQUIREMENTS" >&2
  exit 1
fi

echo "Checking for updates: $REQUIREMENTS"
echo ""
printf "%-40s %-15s %-15s %s\n" "Package" "Current" "Latest" "Status"
printf "%-40s %-15s %-15s %s\n" "-------" "-------" "------" "------"

has_updates=0

while IFS= read -r line || [ -n "$line" ]; do
  # Skip blank lines and comments
  case "$line" in
    ''|\#*) continue ;;
  esac

  # Strip extras like [standard] and inline comments
  pkg_raw="${line%%\[*}"
  pkg_raw="${pkg_raw%%#*}"
  # Trim trailing whitespace
  pkg_raw=$(printf '%s' "$pkg_raw" | sed 's/[[:space:]]*$//')

  # Split on == / >= / ~= / etc.
  pkg_name=$(printf '%s\n' "$pkg_raw" | sed 's/[=~><!].*//')
  if [ "$pkg_name" != "$pkg_raw" ]; then
    current_version=$(printf '%s\n' "$pkg_raw" | sed 's/^[A-Za-z0-9._-]*[=~><!]*//')
  else
    current_version="(unpinned)"
  fi

  # Query PyPI for the latest version
  latest=$(curl -sf "https://pypi.org/pypi/${pkg_name}/json" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['info']['version'])" 2>/dev/null \
    || echo "ERROR")

  if [ "$latest" = "ERROR" ]; then
    status="fetch failed"
  elif [ "$current_version" = "$latest" ]; then
    status="up to date"
  else
    status="UPDATE AVAILABLE"
    has_updates=1
  fi

  printf "%-40s %-15s %-15s %s\n" "$pkg_name" "$current_version" "$latest" "$status"

done < "$REQUIREMENTS"

echo ""
if [ "$has_updates" -eq 1 ]; then
  if [ "$DO_UPDATE" -eq 1 ]; then
    echo "Updating $REQUIREMENTS with pur..."
    pur -r "$REQUIREMENTS"
    echo "Done."
  else
    echo "Updates are available. Run with -u to update requirements.txt."
    exit 1
  fi
else
  echo "All packages are up to date."
fi
