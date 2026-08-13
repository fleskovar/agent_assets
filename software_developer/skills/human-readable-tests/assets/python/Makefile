# Test entry points for a Python project. Copy into the repo root Makefile.
# Every target here is one gesture: no remembering flags, no cd, no venv dance.

PYTEST ?= python -m pytest
CASES_DIR ?= tests/cases

.PHONY: test test-unit test-integration test-cases test-case debug-case debug-test props bless cov lint

## test: everything the CI gate runs
test: lint test-unit test-integration test-cases

## test-unit: fast, hermetic, no I/O
test-unit:
	$(PYTEST) tests/unit -q

## test-integration: real adapters, containers, temp dirs
test-integration:
	$(PYTEST) tests/integration -q

## test-cases: every human-readable case folder
test-cases:
	$(PYTEST) tests/cases -q

## test-case: one case folder — make test-case CASE=overdue-invoice-fees
test-case:
	$(PYTEST) tests/cases -q -k "$(CASE)"

## debug-case: one case under the debugger, no pytest frames in the way
debug-case:
	python -m pdb $(CASES_DIR)/../case_runner.py $(CASE)

## debug-test: drop into the debugger at the point of failure
##   make debug-test K=refund_over_original_amount
debug-test:
	$(PYTEST) -q -k "$(K)" --pdb --maxfail=1 -x

## props: property-based tests, with the slow profile
props:
	HYPOTHESIS_PROFILE=thorough $(PYTEST) tests/properties -q

## bless: regenerate case baselines — READ THE DIFF, commit nothing else
bless:
	UPDATE_BASELINES=1 $(PYTEST) tests/cases -q

## cov: coverage, branch mode, failing under the floor
cov:
	$(PYTEST) --cov=src --cov-branch --cov-report=term-missing --cov-fail-under=80

lint:
	ruff format --check .
	ruff check .
	mypy src
