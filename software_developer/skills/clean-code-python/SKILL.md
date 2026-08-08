---
name: clean-code-python
description: Idiomatic Python for the clean-code-developer standard — frozen dataclasses instead of dicts, Protocol ports, StrEnum constants, injected clocks and config, comprehensions over accumulator loops, numpy/pandas/polars vectorization, pytest, ruff and mypy. Use before writing or refactoring any Python.
type: reference
theme: code-craft
best_for:
  - "Writing new Python modules to the house craft standard"
  - "Refactoring Python that works but reads badly"
  - "Choosing between a dict, a dataclass, a NamedTuple and a TypedDict"
---

## Purpose

The language-specific form of `subagents/clean-code-developer.md` for Python.
That file states the rules; this one states what they look like in Python, which
Python idioms fight them, and which tools enforce them.

Assumes Python 3.11+. Where a 3.12+ feature is materially better it is marked.

---

## Typed containers, not dicts

**The rule:** no `dict[str, Any]` crosses a function boundary. Pick the right
container instead.

| Need | Use |
| --- | --- |
| Immutable value object, the default | `@dataclass(frozen=True, slots=True)` |
| Value object with validation / parsing external input | `pydantic.BaseModel` (if the project has pydantic) |
| Tiny fixed tuple with names, hashable, cheap | `NamedTuple` |
| Describing a dict you do **not** control (an external JSON shape) | `TypedDict`, at the adapter only |
| Genuine key→value collection, homogeneous values, unknown keys | `dict` — this is the legitimate case |

```python
# No — every caller guesses the keys; no tool can rename or check them
def price_order(order: dict, opts: dict = {}) -> float: ...

# Yes
@dataclass(frozen=True, slots=True)
class OrderLine:
    sku: str
    quantity: int
    unit_price: Decimal

@dataclass(frozen=True, slots=True)
class PricingOptions:
    currency: Currency = Currency.USD
    include_tax: bool = True

def price_order(lines: Sequence[OrderLine], options: PricingOptions) -> Money: ...
```

`frozen=True` gives you immutability and hashability; `slots=True` gives you the
memory win and turns a typo'd attribute into an `AttributeError` instead of a
silent new field. Use both by default.

**Never a mutable default argument.** `def f(xs: list = [])` is a shared object
across calls. Use `None` and default inside, or `field(default_factory=list)`.

**Parse at the adapter.** External JSON becomes a typed object at the boundary and
the raw payload goes no further:

```python
def fetch_invoice(self, invoice_id: InvoiceId) -> Invoice:
    payload = self._client.get(f"{INVOICES_PATH}/{invoice_id}").json()
    return _to_invoice(payload)          # the only function that knows the wire shape
```

---

## Constants and enums

```python
# No
if user.role == "admin" and attempts > 3:
    lock_for(30)

# Yes
class Role(StrEnum):
    ADMIN = "admin"
    VIEWER = "viewer"

MAX_LOGIN_ATTEMPTS: Final = 3
LOCKOUT: Final = timedelta(seconds=30)

if user.role is Role.ADMIN and attempts > MAX_LOGIN_ATTEMPTS:
    lock_for(LOCKOUT)
```

- `StrEnum` / `IntEnum` when the value must serialise; plain `Enum` otherwise.
- Compare enum members with `is`, not `==`.
- `Final` on module constants — mypy then rejects reassignment.
- Constants live in the module that owns them, or a `constants.py` **inside that
  package**, never one project-wide constants module.
- DataFrame column names are magic strings too: `COL_QUANTITY: Final = "quantity"`.

---

## Ports with Protocol, not ABC

`typing.Protocol` gives you dependency inversion with no inheritance and no import
from the implementation side — the adapter does not even know the port exists.

```python
# ports/clock.py
class Clock(Protocol):
    def now(self) -> datetime: ...

# ports/invoice_repo.py
class InvoiceRepository(Protocol):
    def get(self, invoice_id: InvoiceId) -> Invoice | None: ...
    def save(self, invoice: Invoice) -> None: ...
```

Use `ABC` only when you need shared implementation in the base, which is rare.
Mark protocols `@runtime_checkable` only if you actually `isinstance` them.

Keep protocols narrow — one per consumer's need. A repository with `get`, `save`,
`search`, `archive`, `count` where the use case calls `get` is four methods of
coupling.

---

## Explicit dependencies

**Collaborators in `__init__`, data in the parameters.**

```python
# No — build() has five hidden inputs and no testable step
class ReportBuilder:
    def build(self) -> Report:
        rows = self._load()              # uses self._source, self._filters
        return self._render(rows)        # uses self._template, self._locale

# Yes
class ReportBuilder:
    def __init__(self, source: RowSource, renderer: Renderer) -> None:
        self._source = source
        self._renderer = renderer

    def build(self, request: ReportRequest) -> Report:
        rows = self._source.fetch(request.filters)
        return self._renderer.render(rows, request.style)


def select_overdue(rows: Sequence[Row], today: date, grace: timedelta) -> list[Row]:
    ...   # nothing hidden: the easiest thing in the codebase to test
```

If a private method never touches `self`, it is a module-level function. Move it
and test it directly.

**Ambient globals get one reference each.**

```python
# No — an untestable function; you cannot make "now" be anything
def is_expired(token: Token) -> bool:
    return token.expires_at < datetime.now(UTC)

# Yes
def is_expired(token: Token, now: datetime) -> bool:
    return token.expires_at < now
```

- `datetime.now`, `uuid4`, `random` → passed in, or behind a `Clock` / `IdSource`
  port.
- `os.environ` → read once at startup into a frozen settings dataclass, passed
  down. It appears in exactly one module.
- Loggers, sessions, HTTP clients → built in the composition root, injected.

**`functools.partial` is dependency injection for functions.** When a function
needs a collaborator but does not need a class, bind it at the composition root:

```python
charge = partial(charge_invoice, gateway=StripeGateway(api_key), clock=SystemClock())
```

**Composition root**: `main.py` / `app.py` / `wiring.py`. The only module that
constructs concrete adapters and knows the whole graph. Skip DI frameworks unless
the project already has one.

---

## Functional Python

```python
# No — declare, loop, append, mutate
result = []
for row in rows:
    if row.status is Status.OPEN:
        result.append(to_summary(row))

# Yes
result = [to_summary(row) for row in rows if row.status is Status.OPEN]
```

- Comprehensions and generator expressions over accumulator loops. Generators
  (`(...)`) when the result is consumed once or is large.
- `itertools` (`chain`, `groupby` on sorted input, `batched` in 3.12+, `islice`)
  and `functools` (`reduce` sparingly, `cache`, `partial`, `singledispatch` when
  it beats a chain of `isinstance`).
- `Sequence` / `Mapping` / `Iterable` in parameters, concrete `list` / `dict` in
  returns. A `Sequence` parameter is a compile-time promise you will not mutate it.
- Return a new object: `replace(invoice, status=Status.PAID)` from `dataclasses`,
  not `invoice.status = ...`.
- Structural pattern matching (`match`) is excellent for closed unions of
  dataclasses — an idiomatic Strategy dispatch with exhaustiveness you can see.
- Failure in the signature: `T | None` for "not found", a `Result`-style union or
  a documented exception for "failed". Never `-1`, `""` or `{}` as a sentinel.

**Where to stop.** No custom `pipe()`, no `toolz` unless already present, no
currying chains, no `reduce` where a loop reads better, no monad emulation. A
local mutable accumulator inside an otherwise pure function is fine.

---

## Vectorization

The Python case where "vectorize when it's free" is most often free.

```python
# Row-at-a-time
total = 0.0
for row in rows:
    if row.status == OrderStatus.SETTLED:
        total += row.quantity * row.unit_price

# Vectorised
settled = orders[orders[COL_STATUS] == OrderStatus.SETTLED.value]
total = float((settled[COL_QUANTITY] * settled[COL_UNIT_PRICE]).sum())
```

- **numpy**: elementwise math, boolean masks, `np.where`, `np.select` for a chain
  of conditions, aggregations along an axis.
- **pandas**: never `iterrows()` — it is the slowest thing in the library and it
  loses dtypes. Use vectorised column ops, `assign` for pipelines, `groupby`,
  `merge`. `apply` with a Python lambda is a loop wearing a costume; use it only
  when there is genuinely no vectorised form, and say so in a comment.
- **polars**: prefer the expression API (`pl.col(...)`) and lazy frames; it is
  vectorised and readable at the same time, which is the ideal case.
- **Beyond arrays**: one `IN (...)` query instead of a query per id, one batched
  API call instead of N, `executemany` instead of a loop of `execute`.

**Do not** build a DataFrame to vectorise twelve objects, do not vectorise
sequential logic (running state, early exit, recursion), and do not write
broadcasting that needs a paragraph of comment. If it costs readability or adds a
dependency, keep the loop.

---

## Layout

```
src/billing/
  __init__.py
  domain/            invoice.py  money.py  pricing_policy.py    # dataclasses + pure rules
  ports/             payment_gateway.py  invoice_repo.py  clock.py
  adapters/          stripe_gateway.py  sqlite_invoice_repo.py  system_clock.py
  application/       charge_invoice.py  issue_refund.py         # use cases
  constants.py
tests/billing/
  domain/            test_pricing_policy.py
  application/       test_charge_invoice.py
```

- `domain/` imports only the stdlib and its siblings. If `domain` imports
  `requests`, `boto3` or `sqlalchemy`, the design is wrong.
- One concept per module. No `utils.py`, `helpers.py`, `common.py`, `misc.py`.
- Keep `__init__.py` thin — re-exports at most. Logic in `__init__.py` is invisible.
- Avoid circular imports by respecting the arrows, not by importing inside
  functions. A local import to break a cycle is a design smell with a bandage.

---

## Tests

pytest. **Additive only** — never edit an existing test to make your change pass
(see the agent file for the two cases when one fails).

```python
def test_refund_over_original_amount_is_rejected() -> None:
    invoice = Invoice(id=InvoiceId("inv_1"), total=Money(100, Currency.USD))

    result = issue_refund(invoice, amount=Money(150, Currency.USD))

    assert result == RefundRejected(reason=RefundError.EXCEEDS_TOTAL)
```

- Name the behaviour, not the method. Arrange / act / assert with blank lines.
- `@pytest.mark.parametrize` for the same behaviour across inputs — one test per
  *behaviour*, parametrised over *data*, not one test per data point.
- Fixtures for construction, not for assertions. A fixture that asserts is a test
  hiding from the reporter.
- Mock at your ports only (a fake class implementing the Protocol beats
  `MagicMock` — it type-checks). Never `mock.patch` a library you do not own;
  never patch `datetime.now` when you could pass `now`.
- `pytest.raises` with `match=` so you assert the actual failure, not any failure.
- Property-based tests (`hypothesis`) where invariants are easy to state — round
  trips, ordering, idempotence.
- Bug fix = failing reproduction test first.

---

## Tooling

Run before reporting done, and fix rather than suppress:

```bash
ruff format .
ruff check --fix .
mypy src            # or: pyright
pytest -q
```

- **ruff** as formatter and linter. Enable at least `E,F,W,I,N,UP,B,SIM,RET,ARG,C4,PTH,RUF`
  in `pyproject.toml`. `ARG` catches unused arguments, `SIM`/`RET`/`C4` catch most
  of the loop-that-should-be-a-comprehension cases in this file automatically.
- **mypy strict** (`strict = true`) or pyright strict. `disallow_untyped_defs` is
  what makes the "type everything" rule enforceable rather than aspirational.
- Suppressions are narrow and reasoned: `# type: ignore[arg-type]  # <why>`, never a
  bare `# type: ignore`, never `# noqa` without a code.

---

## Python-specific traps

- **Mutable default arguments** — the classic; ruff `B006` catches it.
- **Late-binding closures in loops** — `lambda: i` captures the variable, not the
  value. Bind with a default argument or `partial`.
- **`==` on floats and `Decimal`/`float` mixing for money.** Money is `Decimal` or
  integer minor units, never `float`.
- **Truthiness on collections and `0`** — `if not xs` conflates empty and `None`.
  Say `if xs is None` when that is what you mean.
- **Shadowing stdlib names** (`id`, `type`, `list`, `filter`) — ruff `A` catches it.
- **`Any` creeping in through `json.loads`, `**kwargs` and untyped third-party
  libraries.** Parse it into a type at the boundary; add a stub or a narrow
  `cast()` with a comment.
- **Doing work at import time.** Module-level I/O, config reads and client
  construction make everything downstream untestable and slow to import.
