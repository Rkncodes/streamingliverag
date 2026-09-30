"""Service-to-service HTTP calls (phase 7): POST a contract, validate the response contract and its correlation ids."""

from __future__ import annotations

import httpx


class ServiceError(RuntimeError):
    """A downstream service call failed (transport, HTTP status, invalid or mismatched response)."""


def post(http: httpx.Client, path: str, request, response_type):
    try:
        resp = http.post(path, content=request.encode(), headers={"content-type": "application/json"})
    except httpx.HTTPError as e:
        raise ServiceError(f"{path}: {type(e).__name__}: {e}") from e
    if resp.status_code != 200:
        raise ServiceError(f"{path}: HTTP {resp.status_code}: {resp.text[:300]}")
    try:
        out = response_type.decode(resp.content)
    except ValueError as e:
        raise ServiceError(f"{path}: invalid response: {e}") from e
    if out.ids() != request.ids():
        raise ServiceError(f"{path}: correlation ids {out.ids()} do not match the request's {request.ids()}")
    return out
