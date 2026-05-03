#!/bin/sh

pytest backend/tests/ --cov=backend/app --cov-report=term-missing --cov-config=pytest.ini -q 2>&1 | grep -E "^backend|TOTAL" | head -60

pytest

exit 0
