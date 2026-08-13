# Test entry points for a .NET project. Copy into the repo root Makefile.
# `dotnet test --filter` syntax is the thing developers look up every time —
# encode it here once so nobody has to.

CONFIG ?= Debug
SLN ?= Billing.sln

.PHONY: test test-unit test-integration test-cases test-case debug-case debug-test props bless cov lint

## test: everything the CI gate runs
test: lint test-unit test-integration test-cases

## test-unit: fast, hermetic, no I/O
test-unit:
	dotnet test $(SLN) -c $(CONFIG) --filter "Category!=Integration&Category!=Case"

## test-integration: real adapters, Testcontainers, temp dirs
test-integration:
	dotnet test $(SLN) -c $(CONFIG) --filter "Category=Integration"

## test-cases: every human-readable case folder
test-cases:
	dotnet test $(SLN) -c $(CONFIG) --filter "FullyQualifiedName~CaseRunnerTests"

## test-case: one case folder — make test-case CASE=overdue-invoice-fees
test-case:
	dotnet test $(SLN) -c $(CONFIG) --filter "DisplayName~$(CASE)"

## debug-case: one case under the debugger, no test host on the stack
debug-case:
	dotnet run --project tests/CaseDebug -c $(CONFIG) -- $(CASE)

## debug-test: block the test host until a debugger attaches — make debug-test K=Refund
debug-test:
	VSTEST_HOST_DEBUG=1 dotnet test $(SLN) -c $(CONFIG) --filter "FullyQualifiedName~$(K)"

## props: property-based tests (FsCheck / CsCheck) with a wider run
props:
	CSCHECK_ITER=10000 dotnet test $(SLN) -c $(CONFIG) --filter "Category=Property"

## bless: regenerate case baselines — READ THE DIFF, commit nothing else
bless:
	UPDATE_BASELINES=1 dotnet test $(SLN) -c $(CONFIG) --filter "FullyQualifiedName~CaseRunnerTests"

## cov: line + branch coverage
cov:
	dotnet test $(SLN) -c $(CONFIG) --collect:"XPlat Code Coverage"

lint:
	dotnet format --verify-no-changes
	dotnet build $(SLN) -c $(CONFIG) -warnaserror
