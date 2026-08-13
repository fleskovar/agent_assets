# Test entry points for an Odin project. Copy into the repo root Makefile.
# Odin's test flags are define-based and easy to mistype — encode them once.

ODIN ?= odin
FLAGS ?= -vet -strict-style -debug
BUILD ?= build

.PHONY: test test-unit test-cases test-case debug-case debug-test bless memcheck lint

## test: everything the CI gate runs
test: lint test-unit test-cases

## test-unit: the package's own @(test) procs
test-unit:
	$(ODIN) test src -all-packages $(FLAGS) -define:ODIN_TEST_TRACK_MEMORY=true

## test-cases: every human-readable case folder
test-cases:
	$(ODIN) test tests $(FLAGS) -define:ODIN_TEST_TRACK_MEMORY=true

## test-case: one case — make test-case CASE=overdue_invoice_fees  (proc-name form)
test-case:
	$(ODIN) test tests $(FLAGS) -define:ODIN_TEST_NAMES=billing_cases.test_$(CASE)

## debug-case: build and run the single-case executable, then attach a debugger
##   make debug-case CASE=overdue-invoice-fees
debug-case: $(BUILD)/case_debug
	./$(BUILD)/case_debug $(CASE)

$(BUILD)/case_debug:
	@mkdir -p $(BUILD)
	$(ODIN) build tools/case_debug -debug -out:$(BUILD)/case_debug

## debug-test: build the test binary with symbols and hand it to the debugger
debug-test:
	$(ODIN) test tests $(FLAGS) -build-mode:exe -out:$(BUILD)/tests
	@echo "now: gdb --args ./$(BUILD)/tests   (or lldb, or the RAD Debugger)"

## memcheck: leaks are a correctness bug in a language with no GC
memcheck:
	$(ODIN) test tests $(FLAGS) -define:ODIN_TEST_TRACK_MEMORY=true -sanitize:address

## bless: regenerate case baselines — READ THE DIFF, commit nothing else
bless: $(BUILD)/case_debug
	./$(BUILD)/case_debug --write-baselines $(CASE)

lint:
	$(ODIN) check src -all-packages -vet -strict-style
	$(ODIN) check tests -vet -strict-style
