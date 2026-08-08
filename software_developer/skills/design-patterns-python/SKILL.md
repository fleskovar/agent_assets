---
name: design-patterns-python
description: The design patterns from the clean-code-developer standard in idiomatic Python — where a pattern collapses into a function, a module, a Protocol, a decorator or `singledispatch`, and where the full class form still earns its keep. Use when choosing how to structure Python code, not just how to write a line of it.
type: reference
theme: code-craft
best_for:
  - "Implementing Strategy, Factory, Adapter, Facade or Repository in Python"
  - "Deciding whether a pattern needs a class at all in Python"
  - "Recognising the Pythonic name for a pattern you already know from Java or C#"
---

## Purpose

`subagents/clean-code-developer.md` says to use the well-known patterns and name
them out loud. This file says what each one looks like in Python.

**The rule of thumb: in Python, most GoF patterns collapse.** First-class
functions, modules, decorators and duck typing already provide what the pattern's
class hierarchy was invented to fake in a language without them. Use the collapsed
form and **keep the name** — `RetryStrategy` as a function is still a Strategy, and
saying so in the symbol is what buys the reader recognition.

| Pattern | Pythonic form | Full class form when… |
| --- | --- | --- |
| Strategy | A function passed as a `Callable` | The strategy has its own state or several methods |
| Factory | A module-level function | Construction picks between many types and holds config |
| Abstract Factory | A frozen dataclass of callables | Rarely — usually over-engineering in Python |
| Singleton | A module | Almost never. Modules are already singletons |
| Adapter | A class implementing a `Protocol` | Always — this one does not collapse |
| Facade | A module with a few public functions | The subsystem needs held state |
| Decorator (GoF) | `@functools.wraps` decorator | Wrapping objects, not functions |
| Template Method | A higher-order function taking the varying step | The skeleton has many hooks |
| Command | `functools.partial` or a closure | It needs undo, serialisation or a queue |
| Observer | A list of callbacks | Typed events, priorities, unsubscribe bookkeeping |
| Visitor | `functools.singledispatch` or `match` | Almost never |
| Builder | Dataclass + `dataclasses.replace` | Genuinely stepwise, validated construction |
| Iterator | A generator function | Never write `__iter__`/`__next__` by hand |
| Null Object | `T \| None` handled at the edge | A no-op implementation of a Protocol |
| Repository | A class implementing a `Protocol` | Always |
| DI container | `functools.partial` in `main.py` | The project already has one |

---

## Strategy

```python
# The collapsed form: a Callable alias names the strategy
RetryDelay = Callable[[int], timedelta]

def exponential_backoff(attempt: int) -> timedelta:
    return BASE_DELAY * (BACKOFF_FACTOR ** attempt)

def fixed_delay(attempt: int) -> timedelta:
    return BASE_DELAY

def call_with_retry(action: Callable[[], T], delay: RetryDelay, attempts: int) -> T:
    ...
```

The type alias is what makes it a named pattern rather than "a function argument".

Use the class form when the strategy carries state or has more than one method:

```python
class PricingStrategy(Protocol):
    def price(self, lines: Sequence[OrderLine]) -> Money: ...
    def describe(self) -> str: ...
```

**Do not** write an abstract base class with one abstract method and two
subclasses that hold no state. That is a function with extra steps.

**`match` on a closed union** is the other Strategy form, and it is exhaustive in a
way a dict dispatch is not:

```python
def price(rule: PricingRule, lines: Sequence[OrderLine]) -> Money:
    match rule:
        case FlatRate(amount):      return amount
        case PerUnit(unit_price):   return unit_price * total_units(lines)
        case Tiered(tiers):         return price_tiered(lines, tiers)
```

---

## Factory

A factory is a function. Name it `make_x` / `create_x` / `build_x` and keep it in
the module that owns the type.

```python
def make_gateway(settings: Settings) -> PaymentGateway:
    match settings.gateway:
        case GatewayKind.STRIPE:  return StripeGateway(settings.stripe_key)
        case GatewayKind.SANDBOX: return SandboxGateway()
```

**Registry factory** — when the set of types is open and plugins self-register.
This is the one place a decorator earns its keep as a pattern:

```python
_PARSERS: dict[FileKind, type[Parser]] = {}

def register(kind: FileKind) -> Callable[[type[Parser]], type[Parser]]:
    def decorate(cls: type[Parser]) -> type[Parser]:
        _PARSERS[kind] = cls
        return cls
    return decorate

@register(FileKind.CSV)
class CsvParser: ...

def make_parser(kind: FileKind) -> Parser:
    return _PARSERS[kind]()
```

Registry has a real cost — the mapping only populates if the module is imported,
which produces "works in prod, missing in tests" bugs. Use it only when the set is
genuinely open; otherwise a `match` in one factory function is clearer and static.

**`classmethod` alternative constructors** are the idiomatic factory for a type
with several construction paths: `Invoice.from_payload(...)`,
`Money.from_minor_units(...)`.

---

## Adapter and Port

The pattern that does **not** collapse, and the one this standard leans on most.
`Protocol` on the consumer side, a class on the implementation side, no
inheritance link between them:

```python
# ports/payment_gateway.py — declared where it is consumed
class PaymentGateway(Protocol):
    def charge(self, amount: Money, at: datetime) -> ChargeResult: ...

# adapters/stripe_gateway.py — knows the vendor; the vendor's types stop here
class StripePaymentAdapter:
    def __init__(self, client: stripe.Client) -> None:
        self._client = client

    def charge(self, amount: Money, at: datetime) -> ChargeResult:
        response = self._client.PaymentIntent.create(**_to_stripe(amount))
        return _to_charge_result(response)
```

- The adapter is the **only** module that imports the vendor library and the only
  one that knows the wire format.
- `_to_stripe` / `_to_charge_result` are pure functions and get their own tests.
- The port lives with the code that uses it, not with the adapter — that is what
  makes the dependency arrow point inward.

---

## Facade

In Python a facade is usually a module, not a class: `billing/__init__.py` or
`billing/api.py` exporting three functions that hide six collaborators.

```python
# billing/api.py
def charge_invoice(invoice_id: InvoiceId, deps: BillingDeps) -> ChargeResult: ...
def issue_refund(refund: RefundRequest, deps: BillingDeps) -> RefundResult: ...
```

A class facade is right when the subsystem holds state (a session, a connection
pool, an open file). Otherwise a module gives you the same encapsulation with no
instance to pass around.

---

## Decorator

Two distinct things share the name.

**Function decorator** — cross-cutting behaviour, the everyday Python one:

```python
def with_retry(attempts: int, delay: RetryDelay) -> Callable[[F], F]:
    def decorate(fn: F) -> F:
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            ...
        return wrapper
    return decorate
```

Always `functools.wraps`, and keep the wrapper thin — call out to a named function
for anything non-trivial so the logic is testable without the decoration.

**GoF Decorator** — wrapping an object to add behaviour while keeping its
interface. Real and useful for ports:

```python
class CachingInvoiceRepository:                 # same Protocol, wraps another
    def __init__(self, inner: InvoiceRepository, cache: MutableMapping[InvoiceId, Invoice]) -> None:
        self._inner, self._cache = inner, cache

    def get(self, invoice_id: InvoiceId) -> Invoice | None:
        ...
```

Caching, retrying, logging and metrics as wrapping adapters keeps the core
implementation free of all four.

---

## Template Method → higher-order function

```python
# No — inheritance for a single varying step
class Importer(ABC):
    def run(self, path: Path) -> Report: ...
    @abstractmethod
    def _transform(self, rows: Sequence[Row]) -> Sequence[Row]: ...

# Yes — the skeleton is a function, the step is an argument
def run_import(path: Path, transform: Callable[[Sequence[Row]], Sequence[Row]]) -> Report:
    rows = read_rows(path)
    return write_rows(transform(rows))
```

This is the same collapse as Strategy, applied to an algorithm skeleton, and it
kills off most of the inheritance you would otherwise write.

---

## Command

`functools.partial` or a closure, typed by a `Callable` alias:

```python
Command = Callable[[], None]

commands: list[Command] = [partial(send_email, user.email, template), partial(mark_sent, user.id)]
```

Promote to a dataclass when the command needs to be inspected, serialised, queued
or undone — then it is data with a handler, which is also what makes it testable:

```python
@dataclass(frozen=True, slots=True)
class SendEmail:
    to: EmailAddress
    template: TemplateId
```

---

## Observer

A list of callbacks, and nothing more, until it needs unsubscribing:

```python
Listener = Callable[[DomainEvent], None]

class EventBus:
    def __init__(self) -> None:
        self._listeners: dict[type[DomainEvent], list[Listener]] = defaultdict(list)

    def subscribe(self, event: type[DomainEvent], listener: Listener) -> Callable[[], None]:
        self._listeners[event].append(listener)
        return lambda: self._listeners[event].remove(listener)   # unsubscribe handle
```

Returning the unsubscribe function is the detail people skip and then leak. In
async code, listeners are `Awaitable` and the bus gathers them — do not mix sync
and async listeners in one bus.

---

## Visitor → `singledispatch`

```python
@singledispatch
def render(node: Node) -> str:
    raise TypeError(f"no renderer for {type(node)!r}")

@render.register
def _(node: Paragraph) -> str: ...

@render.register
def _(node: Heading) -> str: ...
```

For a **closed** set of dataclasses, `match` is better still — it is exhaustive,
visible in one place, and needs no registration. Reserve `singledispatch` for
hierarchies open to extension from other modules.

---

## Repository

```python
class InvoiceRepository(Protocol):
    def get(self, invoice_id: InvoiceId) -> Invoice | None: ...
    def save(self, invoice: Invoice) -> None: ...
    def find_overdue(self, as_of: date) -> list[Invoice]: ...
```

- Domain-shaped, not table-shaped: `find_overdue(as_of)`, not
  `query(where: str, params: dict)`.
- Returns domain objects, never ORM rows or `Row` tuples. The ORM stops at the
  adapter.
- An in-memory implementation for tests is ten lines and beats every mocking
  framework: it type-checks, it refactors, and its behaviour is readable.

---

## Dependency injection

No container. Three tools, in order of preference:

```python
# 1. partial — for functions
charge = partial(charge_invoice, gateway=StripePaymentAdapter(client), clock=SystemClock())

# 2. constructor injection — for objects with several collaborators
service = ChargeInvoiceService(repository=repo, gateway=gateway, clock=clock)

# 3. a frozen deps dataclass — when the same set travels together
@dataclass(frozen=True, slots=True)
class BillingDeps:
    repository: InvoiceRepository
    gateway: PaymentGateway
    clock: Clock
```

All three are assembled in one composition root (`main.py` / `wiring.py`), which
is the only module importing concrete adapters. Reach for `dependency-injector` or
similar only if the project already uses it.

---

## MVC / MVT in Python web code

The layer names differ by framework; the arrow does not.

- **Django** — models are persistence, views are controllers, templates are views.
  Business rules go in a `services/` or `domain/` package, **not** in a fat model
  and not in a view. A view should read as: parse request → call a use case →
  render.
- **FastAPI / Flask** — the route function is a controller and nothing else:
  validate with a Pydantic model, call the use case, map the result to a response.
  A route with business logic in it cannot be tested without a test client.
- Serializers/schemas are adapters. Domain objects never subclass them, and a
  Pydantic model of an API payload is not a domain entity.

---

## Python-native patterns worth naming

These have no GoF entry and are the ones a Python reviewer expects to see used:

- **Context manager** for acquire/release — `@contextmanager` or `__enter__`/
  `__exit__`. Anything with a paired cleanup should be one, including test fixtures
  and transactions.
- **Generator as pipeline.** `rows = filter_valid(parse(read(path)))` streams and
  never materialises. It is the Iterator pattern for free.
- **Module as singleton.** A module is imported once and cached. A `Singleton`
  metaclass in Python is nearly always a mistake.
- **Descriptor / `__get_validators__`** for reusable attribute behaviour — powerful,
  and easy to overuse. Reach for it only after a dataclass field fails.
- **`__slots__`** and `frozen=True` as the enforcement of immutability.

---

## Anti-patterns

- An `ABC` with one abstract method and no shared implementation — use a `Protocol`
  or a `Callable`.
- A `Singleton` metaclass, or a module-level mutable global standing in for one.
- A `Manager` / `Helper` / `Service` class with no state and five static methods —
  that is a module.
- A registry populated by import side effects, where a missing import means silent
  absence.
- A `Factory` class whose only job is `return Thing(**kwargs)`.
- Inheritance used for code reuse rather than substitutability. Compose instead.
