"""database_query adapter contract (phase 8). No database is connected in this phase.

A DatabaseAdapter answers a validated DatabaseQueryInput (a named, parameterized query; never SQL text) with a
DatabaseQueryOutput. The only adapter here is NotConfigured: every call fails with "database_not_configured", so the
tool can be discovered and its contract exercised, but it never returns rows it did not read from a database.
A PostgreSQL adapter (a later phase) implements the same protocol and maps each QUERIES name to its own statement.
"""

from __future__ import annotations

from typing import Protocol

from .contracts import Correlation, DatabaseQueryInput, DatabaseQueryOutput


class DatabaseUnavailable(RuntimeError):
    """The adapter cannot answer (not configured, not reachable)."""


class DatabaseAdapter(Protocol):
    name: str

    def execute(self, req: DatabaseQueryInput, correlation: Correlation) -> DatabaseQueryOutput: ...


class NotConfigured:
    name = "none"

    def execute(self, req: DatabaseQueryInput, correlation: Correlation) -> DatabaseQueryOutput:
        raise DatabaseUnavailable("no database adapter is configured (PostgreSQL is not part of phase 8)")
