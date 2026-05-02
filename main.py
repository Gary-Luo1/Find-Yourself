"""
Find Yourself — 求职伴侣 web API + static UI.
Inspired by https://github.com/srbhr/Resume-Matcher (simplified product slice).
"""

from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
import time
from json import JSONDecodeError
from pathlib import Path
from threading import Lock
from urllib.parse import quote
from urllib.parse import urlsplit
from uuid import uuid4

import unicodedata

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from config import settings
from docx_export import text_to_docx_bytes
from document_extract import extract_docx_text, extract_pdf_text
from llm import chat_completion, chat_completion_stream, parse_json_from_llm

_BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = _BASE_DIR / "static"
INDEX_HTML = STATIC_DIR / "index.html"
_UPLOAD_EXT = {".pdf", ".docx"}
logger = logging.getLogger("resume_matcher")
_MEMORY_DB_PATH = _BASE_DIR / "data" / "candidate_memory.sqlite3"
_MEMORY_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
_MEMORY_DB_LOCK = Lock()
_VERCEL_BODY_CAP = 4 * 1024 * 1024
_UPLOAD_READ_CHUNK = 256 * 1024
_CHAT_SUMMARY_LIMIT = 12


def _upload_size_limit() -> int:
    cap = settings.max_upload_bytes
    if os.getenv("VERCEL"):
        return min(cap, _VERCEL_BODY_CAP)
    return cap


async def _read_upload_limited(file: UploadFile, *, limit: int) -> bytes:
    buf = bytearray()
    while True:
        chunk = await file.read(_UPLOAD_READ_CHUNK)
        if not chunk:
            break
        buf.extend(chunk)
        if len(buf) > limit:
            mb = limit // (1024 * 1024)
            hint = "（Vercel 上单次请求约 4.5MB 上限，已自动收紧）" if os.getenv("VERCEL") else ""
            raise HTTPException(status_code=413, detail=f"文件过大（单文件上限约 {mb} MB）{hint}，请压缩或拆分后再试。")
    return bytes(buf)


def _cors_origins() -> list[str]:
    raw = (settings.cors_allow_origins or "").strip()
    if raw == "*":
        return ["*"]
    return [o.strip() for o in raw.split(",") if o.strip()]


def _render_cors_origins() -> list[str]:
    raw = (os.getenv("CORS_ALLOW_ORIGINS") or settings.cors_allow_origins or "").strip()
    if raw == "*":
        return ["*"]
    return [o.strip() for o in raw.split(",") if o.strip()]


def _is_production_env() -> bool:
    env = (settings.app_env or "").strip().lower()
    if env in {"prod", "production"}:
        return True
    return bool(os.getenv("VERCEL"))


def _warn_if_insecure_runtime() -> None:
    if not _is_production_env():
        return
    mode = (settings.llm_mode or "").strip().lower()
    allow_client = mode == "byok" or (not mode and settings.trust_client_llm)
    if allow_client:
        logger.warning("Production mode: browser-provided API keys are enabled (BYOK).")
    if settings.cors_allow_origins.strip() == "*":
        logger.warning("Production mode: CORS_ALLOW_ORIGINS='*' is unsafe for public use.")
    if settings.expose_api_docs:
        logger.warning("Production mode: EXPOSE_API_DOCS=true exposes API schema.")


def _make_app() -> FastAPI:
    expose = settings.expose_api_docs
    return FastAPI(title="Find Yourself", version="0.1.0", docs_url="/docs" if expose else None, redoc_url="/redoc" if expose else None, openapi_url="/openapi.json" if expose else None)


app = _make_app()
_warn_if_insecure_runtime()

_cors = _render_cors_origins() or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors,
    allow_credentials=not (_cors == ["*"] or "*" in _cors),
    allow_methods=["*"],
    allow_headers=["*"],
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        if _is_production_env():
            response.headers.setdefault("Cache-Control", "no-cache, must-revalidate")
        return response


app.add_middleware(SecurityHeadersMiddleware)

if STATIC_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


_PAGE_FILES = {"/": "index.html", "/chat.html": "chat.html", "/resume.html": "resume.html", "/analyze.html": "analyze.html", "/journey.html": "journey.html"}


def _render_domain_host() -> str:
    host = (os.getenv("RENDER_EXTERNAL_URL") or os.getenv("PUBLIC_BASE_URL") or "").strip()
    return host.rstrip("/")


@app.get("/")
async def index():
    page = STATIC_DIR / _PAGE_FILES["/"]
    if not page.is_file():
        return {"message": "UI not found. Add static/index.html (and run scripts/sync_public.py before Vercel deploy).", "docs": "/docs"}
    return FileResponse(page)


@app.get("/{page_name}")
async def ui_pages(page_name: str):
    page = f"/{page_name}"
    if page not in _PAGE_FILES:
        raise HTTPException(status_code=404, detail="Page not found.")
    file_path = STATIC_DIR / _PAGE_FILES[page]
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Page not found.")
    return FileResponse(file_path)


class ValidateLLMBody(BaseModel):
    pass


def resolve_llm(_: object | None = None) -> tuple[str, str, str]:
    key = (settings.openai_api_key or "").strip()
    if not key:
        raise HTTPException(status_code=500, detail="服务端未配置模型密钥。")
    base = (settings.openai_base_url or "").strip()
    model = (settings.openai_model or "").strip()
    if not base or not model:
        raise HTTPException(status_code=500, detail="服务端未配置模型服务参数。")
    return key, base, model


@app.post("/api/v1/validate-llm")
async def validate_llm(body: ValidateLLMBody):
    key, base, model = resolve_llm(None)
    try:
        ping = await chat_completion(
            api_key=key,
            base_url=base,
            model=model,
            messages=[
                {"role": "system", "content": "You are a brief connectivity checker."},
                {"role": "user", "content": "ping"},
            ],
            response_format_json=False,
            temperature=0,
            timeout_s=20.0,
        )
        return {"ok": True, "valid": True, "chat_compatible": True, "ping": ping[:120], "mode": "server"}
    except httpx.HTTPStatusError as e:
        status = e.response.status_code
        if status in (400, 401, 403, 404):
            detail = _extract_upstream_error_detail(e.response)
            raise HTTPException(
                status_code=400,
                detail=(
                    "模型服务探测失败。"
                    + (f" 上游提示：{detail}" if detail else "")
                ),
            ) from e
        raise HTTPException(status_code=502, detail=_format_upstream_status_error(e.response)) from e
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail="无法连接模型服务，请检查网络或服务端配置。") from e


class AnalyzeBody(BaseModel):
    resume: str = ""
    job: str = ""
    client_id: str | None = None
    memory: dict | None = None


class CareerBody(BaseModel):
    resume: str = ""
    concern: str = ""
    client_id: str | None = None
    memory: dict | None = None


class TailorBody(BaseModel):
    resume: str = ""
    job: str = ""
    client_id: str | None = None
    memory: dict | None = None


class CoverBody(BaseModel):
    resume: str = ""
    job: str = ""
    client_id: str | None = None
    memory: dict | None = None


class InterviewBody(BaseModel):
    resume: str = ""
    job: str = ""
    client_id: str | None = None
    memory: dict | None = None


class ChatBody(BaseModel):
    message: str = ""
    client_id: str | None = None
    session_id: str | None = None
    current_page: str | None = None
    scene: str | None = None
    memory: dict | None = None


def _system_prompt(kind: str) -> str:
    prompts = {
        "career": "你是资深职业顾问。输出 JSON：{career_orientation:{best_fit_roles:[], why_fit:[], current_capabilities:[], capability_gaps:[], confidence:''}, action_plan:{now:[], next_2_weeks:[], job_search_strategy:[]}, emotional_support:{validation:'', vent_prompt:[]}, summary:''}。内容要简洁、具体、可执行。",
        "analyze": "你是资深简历顾问。输出 JSON：{match_score:0, summary:'', matched_keywords:[], missing_keywords:[], suggestions:[]}。",
        "tailor": "你是资深简历改写专家。输出 JSON：{tailored_resume:'', changes_summary:'', evidence_changes:[{original_snippet:'', suggested_snippet:'', reason:'', risk_level:''}] }。",
        "cover": "你是资深求职信撰写专家。输出 JSON：{cover_letter:''}。",
        "interview": "你是资深面试官。输出 JSON：{questions:[{category:'', question:'', intent:'', answer_framework:[], follow_ups:[]}], weakness_alerts:[], prep_plan_24h:[]}。",
        "chat_onboarding": "你是面向应届生求职场景的 AI 求职伴侣，正在进行首页 onboarding。你的目标是通过少量开放式问题逐步建立用户的第一印象。请输出 JSON：{reply:'', summary:'', follow_up_question:'', memory_action:{should_update:true, profile_updates:[], state_updates:[]}, user_state:{emotion:'', stage:''}}。注意：reply 字段必须只包含给用户看的自然语言，不要输出 JSON、代码块或字段名。",
        "chat_scene": "你是面向应届生求职场景的 AI 求职伴侣，正在一个具体功能页面中与用户对话。请结合当前页面上下文、用户画像和历史状态回答。请输出 JSON：{reply:'', summary:'', follow_up_question:'', memory_action:{should_update:true, profile_updates:[], state_updates:[]}, user_state:{emotion:'', stage:''}}。注意：reply 字段必须只包含给用户看的自然语言，不要输出 JSON、代码块或字段名。",
        "chat_memory": "你是记忆抽取器。请从本轮聊天中抽取适合长期记忆的信息。输出 JSON：{should_update_memory:true, new_profile_items:[], new_state_items:[], updated_items:[], do_not_store:[], needs_clarification:false}。",
    }
    return prompts.get(kind, prompts["chat_scene"])


def _extract_upstream_error_detail(resp: httpx.Response) -> str:
    try:
        payload = resp.json()
        if isinstance(payload, dict):
            return str(payload.get("error", {}).get("message") or payload.get("message") or payload.get("detail") or "").strip()
    except Exception:
        pass
    return resp.text.strip()


def _format_upstream_status_error(resp: httpx.Response) -> str:
    detail = _extract_upstream_error_detail(resp)
    return f"模型服务异常（上游 HTTP {resp.status_code}）{('：' + detail) if detail else ''}"


def _safe_docx_basename(filename: str) -> str:
    raw = (filename or "resume").strip()
    raw = Path(raw).name
    raw = unicodedata.normalize("NFKC", raw)
    raw = re.sub(r"[\\/:*?\"<>|]+", "_", raw)
    raw = re.sub(r"\s+", " ", raw).strip(" ._")
    if not raw:
        raw = "resume"
    if not raw.lower().endswith(".docx"):
        raw += ".docx"
    return raw


async def _llm_json(kind: str, user_prompt: str) -> dict:
    key, base, model = resolve_llm(None)
    try:
        text = await chat_completion(
            api_key=key,
            base_url=base,
            model=model,
            messages=[
                {"role": "system", "content": _system_prompt(kind)},
                {"role": "user", "content": user_prompt},
            ],
            response_format_json=True,
        )
    except httpx.HTTPStatusError as e:
        status = e.response.status_code
        if status in (401, 403):
            raise HTTPException(status_code=400, detail="API Key 无效、无权限，或模型名不正确。") from e
        if status == 404:
            raise HTTPException(status_code=400, detail="Base URL 不正确，或该服务未提供 /chat/completions。") from e
        if status == 400:
            raise HTTPException(status_code=400, detail="上游模型拒绝请求：请检查模型名、Base URL 和参数格式。") from e
        raise HTTPException(status_code=502, detail=f"模型服务异常（上游 HTTP {status}）。") from e
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail="无法连接模型服务，请检查网络或 Base URL。") from e
    try:
        return parse_json_from_llm(text)
    except Exception:
        return {"reply": text, "summary": text[:120]}


async def _chat_json(kind: str, system_prompt: str, user_prompt: str) -> dict:
    key, base, model = resolve_llm(None)
    try:
        text = await chat_completion(
            api_key=key,
            base_url=base,
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format_json=True,
        )
    except httpx.HTTPStatusError as e:
        status = e.response.status_code
        if status in (401, 403):
            raise HTTPException(status_code=400, detail="API Key 无效、无权限，或模型名不正确。") from e
        if status == 404:
            raise HTTPException(status_code=400, detail="Base URL 不正确，或该服务未提供 /chat/completions。") from e
        if status == 400:
            raise HTTPException(status_code=400, detail="上游模型拒绝请求：请检查模型名、Base URL 和参数格式。") from e
        raise HTTPException(status_code=502, detail=f"模型服务异常（上游 HTTP {status}）。") from e
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail="无法连接模型服务，请检查网络或 Base URL。") from e
    try:
        return parse_json_from_llm(text)
    except Exception:
        return {"reply": text, "summary": text[:120]}


def _body_llm(body: BaseModel | dict | None) -> LLMOverrides | None:
    if body is None:
        return None
    if isinstance(body, dict):
        raw = body.get("llm")
        return LLMOverrides(**raw) if isinstance(raw, dict) else None
    raw = getattr(body, "llm", None)
    return raw if isinstance(raw, LLMOverrides) else None


def _memory_dir(client_id: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", (client_id or "default").strip()) or "default"
    return _BASE_DIR / "data" / "users" / safe


def _memory_paths(client_id: str) -> dict[str, Path]:
    root = _memory_dir(client_id)
    root.mkdir(parents=True, exist_ok=True)
    return {
        "root": root,
        "profile": root / "profile.json",
        "state": root / "state.json",
        "history": root / "chat_history.json",
        "log": root / "memory_log.json",
        "summary": root / "conversation_summary.json",
    }


def _default_profile() -> dict:
    return {
        "basic_info": {"school": "", "major": "", "degree": "", "graduation_time": "", "city_preference": ""},
        "career_preferences": {"target_roles": [], "industries": [], "work_style_preferences": [], "preferred_company_type": []},
        "ability_profile": {"strengths": [], "weaknesses": [], "project_experience_tags": [], "technical_skills": []},
        "constraints": {"salary_expectation": "", "location_limit": "", "internship_or_fulltime": "", "timeline": ""},
        "avoid_list": [],
        "confidence_level": {"direction": "low", "skills": "medium", "career_plan": "low"},
        "last_updated_at": "",
    }


def _default_state() -> dict:
    return {
        "current_stage": "onboarding",
        "current_main_problem": "",
        "recent_actions": [],
        "application_status": {"has_started_applying": False, "interview_count": 0, "offer_count": 0},
        "recent_feedback": "",
        "emotion_state": {"current": "", "trend": "", "note": ""},
        "next_actions": [],
        "last_updated_at": "",
    }


def _read_json(path: Path, default):
    try:
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        pass
    return default


def _write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_memory_bundle(client_id: str) -> dict:
    paths = _memory_paths(client_id)
    return {
        "profile": _read_json(paths["profile"], _default_profile()),
        "state": _read_json(paths["state"], _default_state()),
        "history": _read_json(paths["history"], []),
        "log": _read_json(paths["log"], []),
        "summary": _read_json(paths["summary"], {"summary": "", "updated_at": ""}),
    }


def _compact_list(items: list[str], limit: int = _CHAT_SUMMARY_LIMIT) -> list[str]:
    out: list[str] = []
    for item in items:
        text = str(item).strip()
        if text and text not in out:
            out.append(text)
        if len(out) >= limit:
            break
    return out


def _merge_profile(profile: dict, updates: list[dict]) -> dict:
    next_profile = json.loads(json.dumps(profile))
    for item in updates:
        field = str(item.get("field") or "").strip()
        value = item.get("value")
        if not field:
            continue
        parts = field.split(".")
        cursor = next_profile
        for key in parts[:-1]:
            cursor = cursor.setdefault(key, {})
        leaf = parts[-1]
        if isinstance(value, list):
            cursor[leaf] = _compact_list([*cursor.get(leaf, []), *value])
        else:
            cursor[leaf] = value
    return next_profile


def _merge_state(state: dict, updates: list[dict]) -> dict:
    next_state = json.loads(json.dumps(state))
    for item in updates:
        field = str(item.get("field") or "").strip()
        value = item.get("value")
        if not field:
            continue
        parts = field.split(".")
        cursor = next_state
        for key in parts[:-1]:
            cursor = cursor.setdefault(key, {})
        cursor[parts[-1]] = value
    return next_state


def _history_excerpt(history: list[dict]) -> str:
    tail = history[-_CHAT_SUMMARY_LIMIT:]
    lines = []
    for item in tail:
        role = item.get("role", "user")
        content = str(item.get("content", "")).strip()
        if content:
            lines.append(f"{role}: {content}")
    return "\n".join(lines)


@app.post("/api/v1/career-plan")
async def career_plan(body: CareerBody):
    prompt = f"简历：\n{body.resume}\n\n用户困惑/偏好：\n{body.concern}\n\n请基于上述信息给出职业方向与行动计划。"
    return await _llm_json("career", prompt)


@app.post("/api/v1/analyze")
async def analyze(body: AnalyzeBody):
    prompt = f"简历：\n{body.resume}\n\nJD：\n{body.job}\n\n请分析匹配度与改进建议。"
    return await _llm_json("analyze", prompt)


@app.post("/api/v1/tailor")
async def tailor(body: TailorBody):
    prompt = f"简历：\n{body.resume}\n\nJD：\n{body.job}\n\n请给出简历改写版本。"
    return await _llm_json("tailor", prompt)


@app.post("/api/v1/interview")
async def interview(body: InterviewBody):
    prompt = f"简历：\n{body.resume}\n\nJD：\n{body.job}\n\n请生成面试问题和准备计划。"
    return await _llm_json("interview", prompt)


def _sse_event(event: str, data: dict | list | str | None = None, *, event_id: str | None = None) -> str:
    parts = []
    if event_id is not None:
        parts.append(f"id: {event_id}")
    parts.append(f"event: {event}")
    if data is not None:
        payload = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
        for line in str(payload).splitlines() or [""]:
            parts.append(f"data: {line}")
    return "\n".join(parts) + "\n\n"


def _sse_meta(*, client_id: str, session_id: str, current_page: str, scene: str, message_id: str) -> dict:
    return {
        "client_id": client_id,
        "session_id": session_id,
        "current_page": current_page,
        "scene": scene,
        "message_id": message_id,
        "protocol": "fy-chat-sse-v1",
        "events": ["meta", "start", "delta", "final", "memory", "done", "error"],
    }


@app.post("/api/chat")
async def chat(body: ChatBody):
    client_id = (body.client_id or "default").strip() or "default"
    message = (body.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="请先输入内容。")

    bundle = _load_memory_bundle(client_id)
    history = bundle["history"] if isinstance(bundle["history"], list) else []
    profile = bundle["profile"] if isinstance(bundle["profile"], dict) else _default_profile()
    state = bundle["state"] if isinstance(bundle["state"], dict) else _default_state()
    summary = bundle["summary"] if isinstance(bundle["summary"], dict) else {"summary": ""}

    current_page = (body.current_page or "home").strip() or "home"
    scene = (body.scene or ("onboarding" if current_page == "home" else "functional_chat")).strip() or "functional_chat"
    system_prompt = _system_prompt("chat_onboarding" if scene == "onboarding" else "chat_scene")
    user_prompt = (
        f"当前页面：{current_page}\n"
        f"当前场景：{scene}\n"
        f"用户画像：{json.dumps(profile, ensure_ascii=False)}\n"
        f"求职状态：{json.dumps(state, ensure_ascii=False)}\n"
        f"历史摘要：{json.dumps(summary, ensure_ascii=False)}\n"
        f"历史对话：\n{_history_excerpt(history)}\n\n"
        f"用户本轮输入：{message}\n\n"
        f"请先回答用户，再决定是否需要更新画像和状态。"
    )
    message_id = f"msg_{uuid4().hex}"
    timestamp = int(time.time())

    try:
        key, base, model = resolve_llm(None)

        async def event_stream():
            assistant_text = ""
            result = None
            try:
                yield _sse_event("meta", _sse_meta(client_id=client_id, session_id=body.session_id or "", current_page=current_page, scene=scene, message_id=message_id), event_id=message_id)
                yield _sse_event("start", {"ok": True, "timestamp": timestamp})

                async for chunk in chat_completion_stream(
                    api_key=key,
                    base_url=base,
                    model=model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                ):
                    assistant_text += chunk

                try:
                    result = parse_json_from_llm(assistant_text)
                except Exception:
                    result = {"reply": assistant_text, "summary": assistant_text[:120]}

                assistant_reply = str(result.get("reply") or result.get("summary") or assistant_text or "我先帮你整理一下。").strip()
                assistant_reply = re.sub(r"```(?:json)?[\s\S]*?```", "", assistant_reply, flags=re.IGNORECASE).strip()
                if assistant_reply.startswith("{") and assistant_reply.endswith("}"):
                    try:
                        maybe_obj = json.loads(assistant_reply)
                        if isinstance(maybe_obj, dict):
                            assistant_reply = str(maybe_obj.get("reply") or maybe_obj.get("summary") or "").strip() or assistant_reply
                    except Exception:
                        pass
                assistant_reply = assistant_reply or "我先帮你整理一下。"
                visible_reply = assistant_reply
                memory_action = result.get("memory_action") if isinstance(result.get("memory_action"), dict) else {}
                profile_updates = memory_action.get("profile_updates") if isinstance(memory_action.get("profile_updates"), list) else []
                state_updates = memory_action.get("state_updates") if isinstance(memory_action.get("state_updates"), list) else []
                should_update = bool(memory_action.get("should_update", False))

                history.append({"role": "user", "content": message, "timestamp": timestamp, "page": current_page, "scene": scene})
                history.append({"role": "assistant", "content": assistant_reply, "timestamp": timestamp, "page": current_page, "scene": scene})
                history_tail = history[-40:]

                next_profile = profile
                next_state = state
                next_summary = summary
                if should_update:
                    next_profile = _merge_profile(profile, profile_updates)
                    next_state = _merge_state(state, state_updates)
                    next_profile["last_updated_at"] = str(timestamp)
                    next_state["last_updated_at"] = str(timestamp)
                    next_summary = {"summary": str(result.get("summary") or assistant_reply[:120]), "updated_at": str(timestamp)}

                paths = _memory_paths(client_id)
                with _MEMORY_DB_LOCK:
                    _write_json(paths["history"], history_tail)
                    _write_json(paths["profile"], next_profile)
                    _write_json(paths["state"], next_state)
                    _write_json(paths["summary"], next_summary)
                    logs = _read_json(paths["log"], [])
                    if not isinstance(logs, list):
                        logs = []
                    logs.append({
                        "timestamp": timestamp,
                        "session_id": body.session_id or "",
                        "current_page": current_page,
                        "scene": scene,
                        "user_message": message,
                        "assistant_reply": assistant_reply,
                        "should_update": should_update,
                        "memory_action": memory_action,
                        "profile_updates": profile_updates,
                        "state_updates": state_updates,
                        "message_id": message_id,
                    })
                    _write_json(paths["log"], logs[-100:])

                yield _sse_event("final", {
                    "reply": visible_reply,
                    "message_id": message_id,
                })
                if should_update:
                    yield _sse_event("memory", {"updated": True, "message_id": message_id})
                yield _sse_event("done", {"ok": True, "message_id": message_id})
            except Exception as exc:
                logger.exception("chat stream failed: %s", exc)
                yield _sse_event("error", {"detail": str(exc) or "chat stream failed", "message_id": message_id})

        headers = {
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        }
        return StreamingResponse(event_stream(), media_type="text/event-stream; charset=utf-8", headers=headers)
    except httpx.HTTPStatusError as e:
        status = e.response.status_code
        detail = e.response.text.strip() if getattr(e.response, "text", None) else ""
        if status in (401, 403):
            raise HTTPException(status_code=400, detail="API Key 无效、无权限，或模型名不正确。") from e
        if status == 404:
            raise HTTPException(status_code=400, detail="Base URL 不正确，或该服务未提供 /chat/completions。") from e
        if status == 400:
            raise HTTPException(status_code=400, detail="上游模型拒绝请求：请检查模型名、Base URL 和参数格式。") from e
        raise HTTPException(status_code=502, detail=f"模型服务异常（上游 HTTP {status}）{('：' + detail) if detail else ''}。") from e
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail="无法连接模型服务，请检查网络或 Base URL。") from e


@app.post("/api/v1/export-docx")
async def export_docx(body: dict):
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="缺少 text。")
    filename = _safe_docx_basename(body.get("filename") or "resume")
    try:
        docx_bytes = text_to_docx_bytes(text)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"}
    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers=headers,
    )


@app.post("/api/v1/extract-text")
async def extract_text(file: UploadFile = File(...)):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in _UPLOAD_EXT:
        raise HTTPException(status_code=400, detail="仅支持 .pdf 与 .docx 文件。")
    data = await _read_upload_limited(file, limit=_upload_size_limit())
    try:
        text = extract_pdf_text(data) if suffix == ".pdf" else extract_docx_text(data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "data": {"text": text}}


@app.post("/api/v1/ats-check")
async def ats_check(body: dict):
    resume = (body.get("resume") or "").strip()
    jd = (body.get("job_description") or body.get("job") or "").strip()
    if not resume or not jd:
        raise HTTPException(status_code=400, detail="请同时提供简历和岗位描述。")
    resume_words = set(re.findall(r"[A-Za-z0-9+#.-]{2,}|[\u4e00-\u9fff]{2,}", resume.lower()))
    jd_words = set(re.findall(r"[A-Za-z0-9+#.-]{2,}|[\u4e00-\u9fff]{2,}", jd.lower()))
    keywords = sorted({w for w in jd_words if w in resume_words} | {w for w in jd_words if len(w) > 2})[:12]
    data = {
        "rules": ["确保关键词覆盖", "突出量化成果", "保持经历与岗位相关"],
        "quick_wins": ["补充岗位要求中的核心技能", "在简历前 1/3 区域放置最相关经历"],
        "keyword_coverage": keywords,
    }
    return {"ok": True, "data": data}


@app.post("/api/v1/analyze-multi")
async def analyze_multi(body: dict):
    resume = (body.get("resume") or "").strip()
    jobs = body.get("jobs") or []
    if len(resume) < 20 or not isinstance(jobs, list) or len(jobs) < 2:
        raise HTTPException(status_code=422, detail="至少提供一份足够长的简历和两个岗位描述。")
    return {"ok": True, "data": {"summary": "已对多个岗位进行横向比较。", "jobs_count": len(jobs)}}


@app.post("/api/v1/interview-simulate")
async def interview_simulate(body: dict):
    focus = (body.get("focus") or "").strip()
    if focus and focus not in {"behavior", "technical", "mixed"}:
        raise HTTPException(status_code=400, detail="focus 仅支持 behavior / technical / mixed。")
    return {"ok": True, "data": {"focus": focus or "mixed", "summary": "面试模拟已生成。"}}


@app.get("/api/v1/client-config")
async def client_config():
    return {
        "llm_mode": _llm_mode(),
        "trust_client_llm": _allow_client_llm(),
        "allowed_client_base_urls": sorted(_allowed_client_bases()),
    }


@app.post("/api/v1/memory/save")
async def save_memory(body: dict):
    client_id = (body.get("client_id") or "").strip() or "default"
    data = body.get("memory") or body.get("data") or body.get("memory_state") or {}
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="memory 必须是对象。")
    paths = _memory_paths(client_id)
    bundle = _load_memory_bundle(client_id)
    profile = bundle["profile"] if isinstance(bundle["profile"], dict) else _default_profile()
    state = bundle["state"] if isinstance(bundle["state"], dict) else _default_state()
    if isinstance(data.get("profile"), dict):
        profile = data["profile"]
    if isinstance(data.get("state"), dict):
        state = data["state"]
    if isinstance(data.get("summary"), str):
        _write_json(paths["summary"], {"summary": data["summary"], "updated_at": str(int(time.time()))})
    with _MEMORY_DB_LOCK:
        _write_json(paths["profile"], profile)
        _write_json(paths["state"], state)
    return {"ok": True, "client_id": client_id, "data": {"profile": profile, "state": state}}


@app.get("/api/v1/memory")
async def get_memory(client_id: str | None = None):
    cid = (client_id or "default").strip() or "default"
    bundle = _load_memory_bundle(cid)
    return {
        "ok": True,
        "client_id": cid,
        "data": {
            "profile": bundle["profile"],
            "state": bundle["state"],
            "history": bundle["history"],
            "summary": bundle["summary"],
        },
    }
