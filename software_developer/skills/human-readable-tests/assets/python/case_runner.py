"""Load a case folder, run the system under test, produce comparable output.

Split out of the pytest file on purpose: the same three functions are used by
the test, by the `__main__` debug entry point at the bottom, and by the baseline
regenerator. Nothing here knows about pytest.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import date
from pathlib import Path
from typing import Any, Final

from late_fees import Invoice, InvoiceStatus, LateFeePolicy, assess_late_fees

CASES_ROOT: Final = Path(__file__).resolve().parent / "cases"
INPUTS_DIR: Final = "inputs"
OUTPUTS_DIR: Final = "outputs"
JSON_INDENT: Final = 2


def case_dirs(root: Path = CASES_ROOT) -> list[Path]:
    """Every case folder, sorted. Adding a case is adding a folder — never editing a test."""
    return sorted(p for p in root.iterdir() if (p / INPUTS_DIR).is_dir())


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def run_case(case_dir: Path) -> dict[str, Any]:
    """inputs/ on disk -> the output documents this case expects, keyed by filename."""
    inputs = case_dir / INPUTS_DIR
    invoices = tuple(_to_invoice(row) for row in read_json(inputs / "invoices.json"))
    policy = LateFeePolicy(**read_json(inputs / "policy.json"))
    as_of = date.fromisoformat(read_json(inputs / "as_of.json")["as_of_date"])

    assessment = assess_late_fees(invoices, policy, as_of)

    return {
        "assessed_fees.json": [_plain(fee) for fee in assessment.assessed],
        "skipped.json": [_plain(skip) for skip in assessment.skipped],
    }


def read_baselines(case_dir: Path) -> dict[str, Any]:
    return {p.name: read_json(p) for p in sorted((case_dir / OUTPUTS_DIR).glob("*.json"))}


def write_baselines(case_dir: Path, actual: dict[str, Any]) -> None:
    """Only ever called behind UPDATE_BASELINES=1, and its diff gets read by a human."""
    outputs = case_dir / OUTPUTS_DIR
    outputs.mkdir(exist_ok=True)
    for name, document in actual.items():
        text = json.dumps(document, indent=JSON_INDENT, ensure_ascii=False) + "\n"
        (outputs / name).write_text(text, encoding="utf-8")


def _to_invoice(row: dict[str, Any]) -> Invoice:
    return Invoice(
        invoice_id=row["invoice_id"],
        status=InvoiceStatus(row["status"]),
        total_minor_units=row["total_minor_units"],
        due_date=date.fromisoformat(row["due_date"]),
    )


def _plain(record: Any) -> dict[str, Any]:
    """Canonical form: plain JSON scalars, field order from the dataclass."""
    return {key: str(value) if hasattr(value, "value") else value for key, value in asdict(record).items()}


if __name__ == "__main__":
    # Debug entry point. Put a breakpoint on the `run_case` line below and step in:
    #     python case_runner.py overdue-invoice-fees
    # No pytest frames, no fixtures, no collection — one case, one call stack.
    import sys

    name = sys.argv[1] if len(sys.argv) > 1 else case_dirs()[0].name
    result = run_case(CASES_ROOT / name)
    print(json.dumps(result, indent=JSON_INDENT))
