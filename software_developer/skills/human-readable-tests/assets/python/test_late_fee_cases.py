"""pytest runner for human-readable case folders.

One test per case folder, discovered from disk. The test id is the folder name,
so `pytest -k overdue-invoice-fees` and the failure header both name the case.

    make test-cases
    make test-case CASE=overdue-invoice-fees
    make debug-case CASE=overdue-invoice-fees
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from case_runner import case_dirs, read_baselines, run_case, write_baselines

UPDATE_BASELINES = os.environ.get("UPDATE_BASELINES") == "1"


@pytest.mark.parametrize("case_dir", case_dirs(), ids=lambda p: p.name)
def test_case(case_dir: Path) -> None:
    actual = run_case(case_dir)

    if UPDATE_BASELINES:
        write_baselines(case_dir, actual)
        pytest.skip(f"baselines regenerated for {case_dir.name} — read the diff before committing")

    expected = read_baselines(case_dir)

    assert set(actual) == set(expected), (
        f"{case_dir.name}: the runner produced {sorted(actual)} but "
        f"outputs/ holds {sorted(expected)} — see {case_dir / 'README.md'}"
    )
    for name in sorted(expected):
        # One assertion per output file: the failure header names the file that broke.
        assert actual[name] == expected[name], f"{case_dir.name} :: {name}"


def test_every_case_is_documented() -> None:
    """A case folder without a README is a golden file, not a readable test."""
    undocumented = [p.name for p in case_dirs() if not (p / "README.md").is_file()]

    assert undocumented == [], f"case folders missing README.md: {undocumented}"
