"""OpenAI-compatible chat completions via HTTP (works with DeepSeek, OpenRouter, etc.)."""

from __future__ import annotations

import json
import re
from typing import Any

import httpx


def _normalize_openai_base(base_url: str) -> str:
    b = base_url.rstrip("/")
    if not b.endswith("/v1"):
        return b + "/v1"
    return b


async def chat_completion(
    *,
    api_key: str,
    base_url: str,
    model: str,
    messages: list[dict[str, str]],
    temperature: float = 0.35,
    response_format_json: bool = False,
    timeout_s: float = 120.0,
) -> str:
    url = _normalize_openai_base(base_url) + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    def build_body(*, include_response_format: bool) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "stream": False,
        }
        if include_response_format:
            body["response_format"] = {"type": "json_object"}
        return body

    def extract_detail(resp: httpx.Response) -> str:
        try:
            payload = resp.json()
            if isinstance(payload, dict):
                return str(payload.get("error", {}).get("message") or payload.get("message") or payload.get("detail") or "").strip()
        except Exception:
            return resp.text.strip()
        return resp.text.strip()

    async with httpx.AsyncClient(timeout=timeout_s) as client:
        attempts: list[dict[str, Any]] = [build_body(include_response_format=response_format_json)]
        if response_format_json:
            attempts.append(build_body(include_response_format=False))

        last_resp: httpx.Response | None = None
        for body in attempts:
            r = await client.post(url, headers=headers, json=body)
            last_resp = r
            if r.status_code < 400:
                data = r.json()
                try:
                    return data["choices"][0]["message"]["content"] or ""
                except (KeyError, IndexError, TypeError) as e:
                    raise RuntimeError(f"Unexpected LLM response shape: {data!r}") from e
            if body.get("response_format") and r.status_code in {400, 422}:
                continue
            break

        assert last_resp is not None
        detail = extract_detail(last_resp)
        raise httpx.HTTPStatusError(
            f"HTTP {last_resp.status_code}: {detail or 'request failed'}",
            request=last_resp.request,
            response=last_resp,
        )


async def chat_completion_stream(
    *,
    api_key: str,
    base_url: str,
    model: str,
    messages: list[dict[str, str]],
    temperature: float = 0.35,
    timeout_s: float = 120.0,
):
    url = _normalize_openai_base(base_url) + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "stream": True,
    }

    async with httpx.AsyncClient(timeout=timeout_s) as client:
        async with client.stream("POST", url, headers=headers, json=body) as resp:
            if resp.status_code >= 400:
                detail = ""
                try:
                    payload = await resp.aread()
                    text = payload.decode("utf-8", errors="ignore")
                    detail = text.strip()
                except Exception:
                    detail = "request failed"
                raise httpx.HTTPStatusError(
                    f"HTTP {resp.status_code}: {detail or 'request failed'}",
                    request=resp.request,
                    response=resp,
                )

            async for line in resp.aiter_lines():
                line = line.strip()
                if not line:
                    continue
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    payload = json.loads(data)
                except Exception:
                    continue
                try:
                    delta = payload["choices"][0]["delta"]
                    content = delta.get("content")
                    if content:
                        yield content
                except Exception:
                    continue


_JSON_BLOCK = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)


def parse_json_from_llm(text: str) -> dict[str, Any]:
    """Parse JSON from model output; tolerate ```json fences."""
    raw = text.strip()
    m = _JSON_BLOCK.search(raw)
    if m:
        raw = m.group(1).strip()
    return json.loads(raw)
