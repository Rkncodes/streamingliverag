"""HTTP tracing (phase 10A): one server span per request of a FastAPI app, and the W3C trace headers that carry the
trace across a service-to-service call.

  app.add_middleware(TracingMiddleware, service=telemetry.API)
  http.post(path, content=..., headers={..., **trace_headers()})          # services/http.py

The span is named "<METHOD> <route template>" ("POST /query"), never the raw URL; a request that matches no route
is named by its method only. Recorded: the method, the route template, the status code. Not recorded: headers
(Authorization, cookies), the query string, the request and response bodies. A 5xx response or an escaping
exception sets the status ERROR. GET /health is not traced. A `traceparent` header on the request makes the span
a child of the caller's span; without one the span starts a trace.
"""

from __future__ import annotations

from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

from .spans import _failed, span

_PROPAGATOR = TraceContextTextMapPropagator()
UNTRACED_PATHS = frozenset({"/health"})


def trace_headers() -> dict:
    """traceparent / tracestate of the current span, for an outgoing request; {} when nothing is being recorded."""
    carrier: dict = {}
    try:
        _PROPAGATOR.inject(carrier)
    except Exception:
        _failed("inject")
        return {}
    return carrier


def _parent(scope):
    try:
        wanted = (b"traceparent", b"tracestate")
        carrier = {k.decode("latin-1"): v.decode("latin-1") for k, v in scope.get("headers", []) if k in wanted}
        return _PROPAGATOR.extract(carrier) if carrier else None
    except Exception:
        _failed("extract")
        return None


class TracingMiddleware:
    def __init__(self, app, service: str):
        self.app, self.service = app, service

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("path") in UNTRACED_PATHS:
            return await self.app(scope, receive, send)
        method = scope.get("method", "HTTP")
        status = None

        async def record_status(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        with span(method, self.service, {"http.request.method": method}, kind="server", parent=_parent(scope)) as sp:
            try:
                await self.app(scope, receive, record_status)
            except Exception:
                status = status or 500  # what the server answers for an exception no handler took
                raise
            finally:
                route = getattr(scope.get("route"), "path", None)  # set by the router: the template, not the URL
                if isinstance(route, str):
                    sp.rename(f"{method} {route}")
                    sp.set({"http.route": route})
                sp.set({"http.response.status_code": status})
                if status is not None and status >= 500:
                    sp.error(str(status))
