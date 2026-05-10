#!/bin/sh

echo "=== Backend Coverage ==="
pytest backend/tests/ --cov=backend/app --cov-report=term-missing --cov-config=pytest.ini -q 2>&1 | grep -E "^backend|TOTAL" | head -60

pytest

echo ""
echo "=== Frontend Coverage ==="
cd frontend && npx vitest run --coverage 2>&1

exit 0
