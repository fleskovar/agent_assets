---
name: testing-python
description: The Python testing stack for this bundle — pytest layout and fixtures, fakes over MagicMock, hypothesis for the input space, syrupy for snapshots, Testcontainers and respx/responses for integration, the case-folder runner, coverage and mutmut, plus the Makefile targets and the pdb/VS Code entry points for debugging one test or one case. Use before writing or reviewing any Python test.
type: reference
theme: code-craft
best_for:
  - "Choosing the right pytest construct for a behaviour, and the right layer for it"
  - "Wiring the human-readable case runner and its debug entry point in Python"
  - "Configuring hypothesis profiles, coverage and mutation testing without slowing the loop"
---

## Purpose

The Python form of `skills/test-driven-development/SKILL.md`. That file says what
a suite should be; this one says which library, which construct and which command
in Python. Read `skills/clean-code-python/SKILL.md` first — its *Tests* section is
the craft standard, and this file assumes it.

Python 3.11+, pytest 8+.

---

## The stack

| Job | Use | Notes |
| --- | --- | --- |
| Runner + assertions | **pytest** | Plain `assert`; pytest rewrites it into a real diff. No `unittest.TestCase` in new code |
| Parametrisation | `@pytest.mark.parametrize` | One test per *behaviour*, parametrised over *data* |
| Fixtures | pytest fixtures | For construction only. A fixture that asserts is a test hiding from the reporter |
| Fakes | a hand-written class implementing the `Protocol` | Type-checks, reads, cannot drift into asserting call counts |
| Mocking | `unittest.mock` / `pytest-mock` | Last resort, and only at ports you own. Never `mock.patch` a library you do not own |
| Property-based | **hypothesis** | `hypothesis[numpy,pandas]` for array code |
| Snapshots | **syrupy** | For text/JSON blobs that are genuinely unreadable as literals — prefer a case folder |
| HTTP fakes | **respx** (httpx) / **responses** (requests) | At the adapter's own test only |
| Real dependencies | **testcontainers** | Postgres, Redis, S3 (via localstack/minio) |
| API contract | **schemathesis** | Drives an OpenAPI/GraphQL spec against the running service |
| Coverage | **pytest-cov** (`--cov-branch`) | A diagnostic, never a target |
| Mutation | **mutmut** or **cosmic-ray** | Scheduled, on the domain core |
| Parallelism | **pytest-xdist** (`-n auto`) | Only once tests are genuinely independent |
| Time | **pass `now` in** | `freezegun`/`time-machine` exist; needing them means the clock was not injected |

Avoid: `nose`, `pytest-django`'s magic in non-Django code, `unittest.mock.patch`
as the default reach, `faker` inside assertions (non-deterministic data belongs in
hypothesis, with a seed).

---

## Layout

```
tests/
  unit/billing/          test_late_fees.py           # fast, pure, hundreds
  properties/billing/    test_late_fee_properties.py # hypothesis
  cases/                 case_runner.py              # loader + debug entry point
                         test_late_fee_cases.py      # one test per folder
                         overdue-invoice-fees/{inputs,outputs,README.md}
  integration/billing/   test_fee_ledger_repo.py     # testcontainers
  conftest.py                                        # shared fixtures + hypothesis profiles
```

Mirror `src/` under each layer. Do not put tests inside the package unless the
project already does.

---

## Constructs, by what you are proving

### One behaviour, several inputs

```python
@pytest.mark.parametrize(
    ("days_overdue", "expected_reason"),
    [
        (-1, SkipReason.NOT_YET_DUE),
        (0, SkipReason.WITHIN_GRACE_PERIOD),
        (5, SkipReason.WITHIN_GRACE_PERIOD),   # the boundary, inclusive
    ],
    ids=["future", "due_today", "last_grace_day"],
)
def test_invoice_not_past_grace_is_skipped(days_overdue: int, expected_reason: SkipReason) -> None:
    invoice = an_invoice(due_date=AS_OF - timedelta(days=days_overdue))

    assessment = assess_late_fees((invoice,), POLICY, AS_OF)

    assert assessment.skipped[0].reason is expected_reason
```

Always give `ids=` — they are what a CI failure prints. And pin boundaries from
both sides: `5` alone does not distinguish `<=` from `<`; add `6`.

### Failures

```python
def test_negative_rate_is_rejected() -> None:
    with pytest.raises(InvalidPolicy, match="daily_rate_bps must be >= 0"):
        LateFeePolicy(currency="USD", daily_rate_bps=-1, ...)
```

`match=` is not optional. `pytest.raises(Exception)` passes on a typo in the test.

### Fakes over mocks

```python
class InMemoryInvoiceRepository:
    """Fake for the InvoiceRepository Protocol. It type-checks; a MagicMock does not."""

    def __init__(self, invoices: Sequence[Invoice]) -> None:
        self._by_id = {i.invoice_id: i for i in invoices}

    def get(self, invoice_id: InvoiceId) -> Invoice | None:
        return self._by_id.get(invoice_id)

    def save(self, invoice: Invoice) -> None:
        self._by_id[invoice.invoice_id] = invoice
```

A `mypy` run proves this fake still matches the port after a refactor. `MagicMock`
proves nothing and silently answers every method you misspell.

### Builders for test data

```python
def an_invoice(**overrides: Any) -> Invoice:
    """Defaults that are valid and boring; each test overrides only what it is about."""
    return replace(
        Invoice("INV-0001", InvoiceStatus.OPEN, 100_00, date(2026, 3, 1)),
        **overrides,
    )
```

The test then reads as the behaviour: `an_invoice(status=InvoiceStatus.SETTLED)`.

---

## Human-readable case folders

Full pattern: `skills/human-readable-tests/SKILL.md`. Working code:
`skills/human-readable-tests/assets/python/` — `case_runner.py` (loader, canonical
serialisation, `__main__` debug entry point), `test_late_fee_cases.py` (one
parametrised test per folder, plus a check that every folder has a README), and
the `Makefile`.

Three Python-specific notes:

- **Parametrise over `Path` objects with `ids=lambda p: p.name`**, so the test id
  is the case name and `-k overdue-invoice-fees` works.
- **Serialise canonically**: `json.dumps(..., indent=2, sort_keys=False)` with
  dataclass field order, a trailing newline, and `Decimal`/enum converted at the
  boundary. A `set` in the output is a non-determinism waiting to happen.
- **Keep the loader importable without pytest.** That is what makes
  `python case_runner.py <case>` a debugging entry point.

---

## Generated tests

```python
# conftest.py — profiles, so the fast loop stays fast
settings.register_profile("dev", max_examples=50, deadline=timedelta(milliseconds=500))
settings.register_profile("thorough", max_examples=2_000, deadline=None)
settings.load_profile(os.environ.get("HYPOTHESIS_PROFILE", "dev"))
```

- Compose **domain-object strategies** (`@st.composite`) and share them from
  `tests/generators/`. Constrain by construction; `assume()` that rejects most
  candidates makes hypothesis give up.
- `@example(...)` pins the values you know matter, and is where every shrunk
  counterexample goes before you fix the code.
- Cache `.hypothesis/` in CI so a nightly counterexample is replayed on the next
  push.
- Stateful: `RuleBasedStateMachine` for caches, queues and repositories.

Details and the invariant catalogue: `skills/automatic-test-generation/SKILL.md`.

---

## Integration tests

```python
@pytest.fixture(scope="session")
def postgres() -> Iterator[PostgresContainer]:
    with PostgresContainer("postgres:16-alpine") as container:
        run_migrations(container.get_connection_url())
        yield container
```

- Session-scoped container, **function-scoped transaction rolled back** — fast and
  independent, in that order.
- Assert the things only the real dependency can tell you: numeric scale, timezone
  handling, unicode, null semantics, constraint violations, migration order.
- Never point a test at a shared or staging database.

---

## Running the suite

`skills/human-readable-tests/assets/python/Makefile` is the copyable version.

```bash
make test              # lint + unit + integration + cases — what CI runs
make test-unit         # the fast loop, target under a minute
make test-cases        # every human-readable case folder
make test-case CASE=overdue-invoice-fees
make props             # hypothesis, thorough profile
make cov               # branch coverage, term-missing
make bless             # regenerate case baselines — read the diff
```

Useful directly: `-x` stop at first failure, `--lf` last failed, `-q` quiet,
`-n auto` parallel (xdist), `--durations=10` to find the slow ones.

---

## Debugging a test — the part that matters

```bash
make debug-test K=refund_over_original_amount   # pytest --pdb -x on one test
make debug-case CASE=overdue-invoice-fees       # one case, no pytest frames
python -m pdb tests/cases/case_runner.py overdue-invoice-fees
```

- `--pdb` drops into the debugger **at the failure**, with the frame intact.
  `--pdb --maxfail=1 -x` is the everyday form.
- `breakpoint()` in the code under test respects `PYTHONBREAKPOINT`; combine with
  `-s` so pytest does not capture stdin.
- `--pdbcls=IPython.terminal.debugger:TerminalPdb` if the project has IPython.
- **VS Code**: `skills/human-readable-tests/assets/python/launch.json` has three
  entries — current test file, test at cursor, and *one human-readable case*.
  `"justMyCode": false` is required or you cannot step into library frames.
- **Post-mortem in CI**: `--tb=long --showlocals` prints the locals at the
  failure, which is usually enough to avoid a re-run.

Put the case-debug command in each case's `README.md`. A developer's first
breakpoint in this codebase should cost one command and no reading.

---

## Python-specific test traps

- **`assert` in a helper the tests call** — pytest only rewrites assertions in test
  modules and `conftest.py`. Register others with
  `pytest.register_assert_rewrite("tests.helpers")` or the failure loses its diff.
- **Mutable module-level fixtures** shared between tests: a list defined at module
  scope is one object for the whole run.
- **`mock.patch` targets the import site**, not the definition site — patch
  `mymodule.datetime`, not `datetime.datetime`. Better: do not patch; inject.
- **Floating point in assertions** — `pytest.approx` for floats, and `Decimal` or
  integer minor units for money.
- **Dict and set ordering** — dicts are insertion-ordered, sets are not. Never
  assert on a set's iteration order; sort before comparing.
- **`tmp_path` over `/tmp`** — a test writing to a fixed path fails under xdist.
- **Import-time side effects** in the module under test make every test slow and
  the first import order-dependent.
- **`caplog` needs the right propagation** — if the app configures logging at
  import, `caplog` silently captures nothing.
- **Async**: `pytest-asyncio` in `asyncio_mode = "auto"`; a forgotten `await`
  yields a coroutine that compares unequal to everything with no error.

---

## References

- `skills/clean-code-python/SKILL.md` — the craft rules these tests enforce.
- `skills/test-driven-development/SKILL.md` — layers, stories, definition of done.
- `skills/human-readable-tests/SKILL.md` + `assets/python/` — the case pattern.
- `skills/automatic-test-generation/SKILL.md` — hypothesis, fuzzing, mutation.
- `skills/bug-fix-workflow/SKILL.md` — the defect loop.
