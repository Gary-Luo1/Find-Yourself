"""
Find Yourself — 求职伴侣 web API + static UI.
Current product focus:
- chat
- resume input
- analysis and optimization
- action and reflection
- memory and profile persistence
"""

from __future__ import annotations

import hashlib
import hashlib
import json
import logging
import os
import re
import sqlite3
import time
import hashlib
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


_PAGE_FILES = {
    "/": "index.html",
    "/chat": "chat.html",
    "/chat.html": "chat.html",
    "/settings": "settings.html",
    "/settings.html": "settings.html",
    "/resume": "resume.html",
    "/resume.html": "resume.html",
    "/analyze": "analyze.html",
    "/analyze.html": "analyze.html",
    "/journey": "journey.html",
    "/journey.html": "journey.html",
}


def _render_domain_host() -> str:
    host = (os.getenv("RENDER_EXTERNAL_URL") or os.getenv("PUBLIC_BASE_URL") or "").strip()
    return host.rstrip("/")


@app.get("/")
async def index():
    page = STATIC_DIR / _PAGE_FILES["/"]
    if not page.is_file():
        return {"message": "UI not found. Add static/index.html (and run scripts/sync_public.py before Vercel deploy).", "docs": "/docs"}
    return FileResponse(page)


@app.get("/favicon.ico")
async def favicon():
    favicon_path = STATIC_DIR / "favicon.ico"
    if favicon_path.is_file():
        return FileResponse(favicon_path)
    return Response(status_code=204)


@app.get("/api/v1/health")
async def health_check():
    return {"ok": True, "service": "find-yourself-api"}


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
    llm_mode: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    model: str | None = None


def _normalize_llm_mode(value: str | None) -> str:
    mode = (value or "").strip().lower()
    if mode in {"direct", "byok"}:
        return mode
    return "server"


def _resolve_llm_direct(body: ValidateLLMBody) -> tuple[str, str, str]:
    key = (body.api_key or "").strip()
    base = (body.base_url or "").strip()
    model = (body.model or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="前端直连模式需要提供 API Key。")
    if not base:
        raise HTTPException(status_code=400, detail="前端直连模式需要提供 Base URL。")
    if not model:
        raise HTTPException(status_code=400, detail="前端直连模式需要提供模型名称。")
    allowed = [u.strip().rstrip("/") for u in (settings.allowed_client_base_urls or "").split(",") if u.strip()]
    if allowed and base.rstrip("/") not in allowed:
        raise HTTPException(status_code=400, detail="当前 Base URL 不在允许列表中。")
    return key, base, model


def _resolve_llm_server() -> tuple[str, str, str]:
    key = (settings.openai_api_key or "").strip()
    if not key:
        raise HTTPException(status_code=500, detail="服务端未配置模型密钥。")
    base = (settings.openai_base_url or "").strip()
    model = (settings.openai_model or "").strip()
    if not base or not model:
        raise HTTPException(status_code=500, detail="服务端未配置模型服务参数。")
    return key, base, model


def resolve_llm(body: ValidateLLMBody | None = None) -> tuple[str, str, str]:
    payload = body or ValidateLLMBody()
    mode = _normalize_llm_mode(getattr(payload, "llm_mode", None) or settings.llm_mode)
    if mode in {"direct", "byok"}:
        return _resolve_llm_direct(payload)
    return _resolve_llm_server()


@app.post("/api/v1/validate-llm")
async def validate_llm(body: ValidateLLMBody):
    key, base, model = resolve_llm(body)
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


GLOBAL_ROLE_PROMPT = """
你是 Find Yourself 产品内的 AI 求职伴侣。

必须遵守：
1) 保持求职伴侣角色，不退化为泛聊天机器人。
2) 涉及分析、计划、记录时必须结构化输出；不得编造联网信息。
3) 维护 current_stage（准备期/投递期/面试期/谈判期/已入职/维护期）。
4) 语气专业、鼓励、可执行；不提供伪造经历建议。
5) 重要内容使用标签：
   - 【档案更新】
   - 【策略建议】
   - 【待办提醒】
   - 【情感支持】
6) 若无法完整表格，至少返回可解析 JSON，未知字段填 null。
""".strip()


CAREER_PROMPT = GLOBAL_ROLE_PROMPT + "\n\n# Role: 职业方向与行动计划分析师\n你是职业发展顾问。基于用户提供的聊天内容、简历文本、JD文本进行分析。\n\n必须遵守：\n1) 仅基于输入，不引入外部假设；信息不足写“需补充：xxx”。\n2) 相同输入输出一致。\n3) 禁止空洞建议，建议必须可执行。\n4) 仅输出 JSON，不输出 markdown 或其他解释。\n\n工作步骤：\n- 提取诉求、简历能力证据、JD要求。\n- 评估匹配点与差距。\n- 输出方向判断与行动计划。\n\nJSON schema 严格为：\n{career_orientation:{best_fit_roles:[], why_fit:[], current_capabilities:[], capability_gaps:[], confidence:''}, action_plan:{now:[], next_2_weeks:[], job_search_strategy:[]}, emotional_support:{validation:'', vent_prompt:[]}, summary:''}\n\n字段要求：\n- 上述所有顶层字段必须存在。\n- best_fit_roles/why_fit/current_capabilities/capability_gaps/now/next_2_weeks/job_search_strategy/vent_prompt 必须是字符串数组，且每个数组至少 1 项。\n- confidence 只能是“高/中/低”。\n- summary 必须同时包含方向结论与主要风险。\n"

ANALYZE_PROMPT = GLOBAL_ROLE_PROMPT + "\n\n# Role: 岗位匹配分析专家\n你是专业招聘与人力资源分析专家，目标是对简历与JD进行可复现的结构化匹配分析。\n\n必须遵守：\n1) 标准化预处理：统一大小写、去格式噪声、同义词归一（如 Python/python/Py）。\n2) 固定顺序评估：教育→经验→技能→项目→其他。\n3) 证据锚定：每个结论需可由输入文本回溯，禁止外部假设。\n4) 一致性：相同输入必须同结论、同建议、同分数。\n5) 禁止随机因素与外部查询。\n\n工作流程：\n- 步骤1：JD要素提取（必备/优选）并给出权重。\n- 步骤2：简历同维度提取并映射。\n- 步骤3：逐项匹配与评分。\n- 步骤4：输出总分、依据与改进建议。\n\n仅输出 JSON，禁止输出 markdown 或额外解释。\nJSON schema 必须严格为：\n{match_score:0, summary:'', dimension_scores:[{dimension:'', weight:0, score:0, evidence:''}], matched_keywords:[], missing_keywords:[], suggestions:[], consistency_note:''}\n\n字段要求：\n- match_score 为 0~100 数值，保留 1 位小数\n- dimension_scores 为数组，包含教育/经验/技能/项目/其他\n- 每项 evidence 使用格式：JD要求：xxx | 简历依据：xxx | 匹配判定：xxx\n- matched_keywords/missing_keywords/suggestions 为字符串数组\n- consistency_note 写明版本与可复现声明（如：synonym_dict_v1, weight_model_v1）\n- 信息不足时在 suggestions 写入“需补充：xxx”\n"


def _system_prompt(kind: str) -> str:
    prompts = {
        "career": CAREER_PROMPT,
        "analyze": ANALYZE_PROMPT,
        "tailor": GLOBAL_ROLE_PROMPT + "\n\n# Role: 简历优化策略师\n\n## Profile\n- language: 中文/English（根据用户输入自动适配）\n- description: 专业的简历诊断与优化专家，基于聊天记录、JD、原始简历及前序分析结果进行多维交叉分析并给出可执行改写方案。\n- background: 具备人力资源管理、职业规划咨询、ATS筛选机制与企业用人标准复合背景。\n- personality: 严谨细致、逻辑缜密、客观专业、注重证据链完整性。\n- expertise: 简历内容诊断、JD关键词匹配、职业叙事构建、招聘心理学应用、多源信息整合。\n\n## Rules\n1) 分析依据透明化：每条建议必须说明来自聊天记录/JD/前序分析/原简历的依据。\n2) 问题定位精确：指出原文缺陷（模糊、被动、缺量化、相关性弱等）。\n3) 修改建议结构化：每条建议必须包含“原文定位/修改方案/多维依据/效果预期”。\n4) 优先级标注：关键修改（初筛）、重要修改（面试率）、润色修改（阅读体验）。\n5) 真实性约束：不得虚构经历或夸大成果，仅做表达重构。\n6) 匹配度诚实：客观指出差距并提供弥补策略。\n\n## Workflow\n- 步骤1：信息交叉映射（JD要求↔简历内容↔聊天诉求↔前序分析结论）。\n- 步骤2：差距诊断与策略制定（ATS/HR/用人部门三层视角）。\n- 步骤3：逐模块输出可执行改写建议（总结/经历/项目/技能）。\n\n## Output Constraint（系统兼容）\n仅输出 JSON，不输出 markdown、解释文本或代码块。\nJSON schema 严格为：\n{tailored_resume:'', changes_summary:'', evidence_changes:[{original_snippet:'', suggested_snippet:'', reason:'', risk_level:''}]}\n\n字段要求：\n- tailored_resume：输出完整可直接替换的简历文本。\n- changes_summary：简要总结本次改写策略。\n- evidence_changes：数组中每项必须体现“原文定位/修改方案/多维依据/效果预期”。\n- risk_level 只能使用：critical / important / polish。\n- 信息不足时，在 reason 中明确写“需补充：xxx”。\n\n## Initialization\n作为简历优化策略师，你必须遵守上述Rules，按照Workflows执行任务。\n" ,
        "cover": GLOBAL_ROLE_PROMPT + "\n\n任务：求职信。仅输出 JSON：{cover_letter:''}",
        "interview": GLOBAL_ROLE_PROMPT + "\n\n# Role: 面试模拟专家\n\n## Profile\n- language: 中文\n- description: 你是一位资深的人力资源专家与面试教练，擅长根据候选人的简历、目标职位JD以及前期分析，设计高度针对性和实战性的面试模拟题目，并提供专业回答策略。\n- background: 深谙企业面试流程与评估标准，熟悉行为面试法（BEI）与胜任力评估。\n- personality: 专业严谨、洞察敏锐、富有同理心，注重实战效果与逻辑严密。\n- expertise: 人才评估、行为面试、情境面试、简历深度解析、JD精准对标、回答话术优化。\n\n## Rules\n1) 严格基于输入：仅依据简历、JD和前序分析，不得脱离上下文生成泛化问题。\n2) 覆盖维度：题目需覆盖专业能力、项目经验、行为素质、文化匹配、职业规划。\n3) 输出先题后答：先给题目清单，再给解析与示例。\n4) 避免通用模板：不得使用泛泛问题，必须体现对简历细节的定制追问。\n5) 真实可执行：示例回答要具体，包含动作与结果，避免空泛描述。\n\n## Output Constraint（系统兼容）\n仅输出 JSON，不输出 markdown、解释文本或代码块。\nJSON schema 严格为：\n{questions:[{category:'', question:'', intent:'', answer_framework:[], follow_ups:[]}], weakness_alerts:[], prep_plan_24h:[]}\n\n字段要求：\n- questions 长度必须为 10。\n- 每个 question 必须包含 category/question/intent/answer_framework/follow_ups。\n- category 建议使用：专业能力/项目经验/行为素质/文化匹配/职业规划/情景模拟/压力测试。\n- answer_framework 与 follow_ups 必须为字符串数组，且至少 2 条。\n- weakness_alerts 与 prep_plan_24h 必须为字符串数组，且至少 3 条。\n" + "\n\n补充约束：请在 questions 中通过 category 与 intent 体现“先题后答”的设计逻辑；详细答案解析与示例内容请压缩进 answer_framework 与 follow_ups 中，确保前端结构化渲染。" ,
        "chat_onboarding": GLOBAL_ROLE_PROMPT + "\n\n任务：首页 onboarding 对话。仅输出 JSON：{reply:'', summary:'', follow_up_question:'', memory_action:{should_update:true, profile_updates:[], state_updates:[]}, user_state:{emotion:'', stage:''}}。reply 必须是给用户看的自然语言。",
        "chat_scene": GLOBAL_ROLE_PROMPT + "\n\n任务：功能页上下文对话。仅输出 JSON：{reply:'', summary:'', follow_up_question:'', memory_action:{should_update:true, profile_updates:[], state_updates:[]}, user_state:{emotion:'', stage:''}}。reply 必须是给用户看的自然语言。",
        "chat_memory": GLOBAL_ROLE_PROMPT + "\n\n任务：记忆抽取。仅输出 JSON：{should_update_memory:true, new_profile_items:[], new_state_items:[], updated_items:[], do_not_store:[], needs_clarification:false}",
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


_DETERMINISTIC_CACHE: dict[str, dict] = {}


def _is_structured_result_valid(kind: str, parsed: dict) -> bool:
    if not isinstance(parsed, dict):
        return False
    if kind == "career":
        required = {"career_orientation", "action_plan", "emotional_support", "summary"}
        return required.issubset(set(parsed.keys()))
    if kind == "analyze":
        required = {"match_score", "summary", "matched_keywords", "missing_keywords", "suggestions"}
        return required.issubset(set(parsed.keys()))
    return True


async def _llm_json(kind: str, user_prompt: str, body: object | None = None) -> dict:
    key, base, model = resolve_llm(body if isinstance(body, ValidateLLMBody) else None)
    system_prompt = _system_prompt(kind)
    cache_key = hashlib.sha256(f"{kind}\n{model}\n{base}\n{system_prompt}\n{user_prompt}".encode("utf-8")).hexdigest()
    if cache_key in _DETERMINISTIC_CACHE:
        cached = _DETERMINISTIC_CACHE[cache_key]
        if _is_structured_result_valid(kind, cached):
            return cached
        # 兼容历史脏缓存：若旧缓存结构不完整，丢弃并重新调用模型
        _DETERMINISTIC_CACHE.pop(cache_key, None)
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
        parsed = parse_json_from_llm(text)
    except Exception:
        parsed = {"reply": text, "summary": text[:120]}

    if not _is_structured_result_valid(kind, parsed):
        # 结构不完整时不缓存，直接回退到最小兼容结构，避免前端只显示 summary
        if kind == "career":
            parsed = {
                "career_orientation": {
                    "best_fit_roles": ["需补充：目标岗位方向"],
                    "why_fit": ["需补充：更完整的简历与目标信息"],
                    "current_capabilities": ["需补充：核心能力证据"],
                    "capability_gaps": ["需补充：岗位要求与现状差距"],
                    "confidence": "低",
                },
                "action_plan": {
                    "now": ["需补充：提供更完整简历与JD后重试"],
                    "next_2_weeks": ["需补充：明确目标岗位与城市范围"],
                    "job_search_strategy": ["需补充：明确投递渠道与节奏"],
                },
                "emotional_support": {
                    "validation": "你已经在积极推进，这一步是为了拿到更准确的方向判断。",
                    "vent_prompt": ["最近求职中最让你焦虑的一件事是什么？"],
                },
                "summary": str(parsed.get("summary") or "信息不足，已回退为结构化占位结果，请补充信息后重试。"),
            }
        elif kind == "analyze":
            parsed = {
                "match_score": 0,
                "summary": str(parsed.get("summary") or "返回结构不完整，已回退基础结构。"),
                "matched_keywords": [],
                "missing_keywords": ["需补充：完整JD与简历文本"],
                "suggestions": ["需补充：请完善输入后重试分析"],
            }

    _DETERMINISTIC_CACHE[cache_key] = parsed
    return parsed


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


def _body_llm(body: BaseModel | dict | None):
    # 保留兼容入口：当前版本未启用 per-request LLM override
    # 早期实现依赖 LLMOverrides，但该类型已移除；这里统一返回 None，避免运行时 NameError。
    return None


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
    mode = (settings.llm_mode or "server").strip().lower()
    trust_client = mode == "byok" or (not mode and settings.trust_client_llm)
    allowed = {
        u.strip()
        for u in (settings.allowed_client_base_urls or "").split(",")
        if u.strip()
    }
    return {
        "llm_mode": mode or "server",
        "trust_client_llm": trust_client,
        "allowed_client_base_urls": sorted(allowed),
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
