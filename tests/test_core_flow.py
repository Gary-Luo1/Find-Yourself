from fastapi.testclient import TestClient
import pytest

import main
from llm import parse_json_from_llm
from main import _safe_docx_basename, app, resolve_llm


def test_parse_json_from_llm_accepts_fenced_json():
    text = """```json
{"match_score": 88, "summary": "ok"}
```"""
    data = parse_json_from_llm(text)
    assert data["match_score"] == 88
    assert data["summary"] == "ok"


def test_safe_docx_basename_strips_path_and_illegal_chars():
    filename = _safe_docx_basename("../unsafe?:name")
    assert filename.endswith(".docx")
    assert ".." not in filename
    assert "/" not in filename
    assert "\\" not in filename


def test_export_docx_api_returns_docx_attachment():
    client = TestClient(app)
    resp = client.post(
        "/api/v1/export-docx",
        json={"text": "line1\nline2", "filename": "我的简历"},
    )
    assert resp.status_code == 200
    assert (
        resp.headers["content-type"]
        == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    assert "attachment;" in resp.headers.get("content-disposition", "")
    assert len(resp.content) > 100


def test_extract_text_rejects_unsupported_extension():
    client = TestClient(app)
    files = {"file": ("resume.txt", b"hello", "text/plain")}
    resp = client.post("/api/v1/extract-text", files=files)
    assert resp.status_code == 400
    assert "仅支持 .pdf 与 .docx" in resp.json()["detail"]


def test_extract_text_rejects_too_large_file(monkeypatch):
    client = TestClient(app)
    monkeypatch.setattr(main, "_upload_size_limit", lambda: 10)
    files = {"file": ("resume.pdf", b"x" * 11, "application/pdf")}
    resp = client.post("/api/v1/extract-text", files=files)
    assert resp.status_code == 413
    assert "文件过大" in resp.json()["detail"]


def test_ats_check_returns_rules():
    client = TestClient(app)
    resp = client.post(
        "/api/v1/ats-check",
        json={
            "resume": "负责系统开发\n参与需求讨论\nPython",
            "job_description": "需要 Python FastAPI Docker CI/CD 经验",
        },
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert isinstance(data["rules"], list)
    assert isinstance(data["quick_wins"], list)
    assert len(data["rules"]) >= 1


def test_analyze_multi_requires_at_least_two_jobs():
    client = TestClient(app)
    resp = client.post(
        "/api/v1/analyze-multi",
        json={
            "resume": "这是一个足够长的简历内容，用于触发参数校验，长度超过二十个字。",
            "jobs": ["这是一个足够长的岗位描述，用于触发参数校验，长度超过二十个字。"],
        },
    )
    assert resp.status_code == 422


def test_compare_improvement_returns_summary():
    client = TestClient(app)
    resp = client.post(
        "/api/v1/compare-improvement",
        json={
            "before_resume": "负责系统开发\n参与需求讨论\nPython FastAPI",
            "after_resume": "主导 FastAPI 服务开发并上线，接口延迟下降 20%\nPython FastAPI Docker CI/CD",
            "job_description": "需要 Python FastAPI Docker CI/CD 经验，强调量化成果",
        },
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert "summary" in data
    assert "keyword_coverage" in data
    assert "ats_risk" in data


def test_interview_simulate_rejects_invalid_focus():
    client = TestClient(app)
    resp = client.post(
        "/api/v1/interview-simulate",
        json={
            "resume": "这是一个足够长的简历内容，用于触发参数校验，长度超过二十个字。",
            "job_description": "这是一个足够长的岗位描述，用于触发参数校验，长度超过二十个字。",
            "focus": "invalid-focus",
        },
    )
    assert resp.status_code == 400
    assert "focus 仅支持" in resp.json()["detail"]


def test_client_config_returns_llm_mode(monkeypatch):
    client = TestClient(app)
    monkeypatch.setattr(main.settings, "llm_mode", "server")
    monkeypatch.setattr(main.settings, "trust_client_llm", True)
    resp = client.get("/api/v1/client-config")
    assert resp.status_code == 200
    data = resp.json()
    assert data["llm_mode"] == "server"
    assert data["trust_client_llm"] is False


def test_resolve_llm_byok_base_url_allowlist(monkeypatch):
    monkeypatch.setattr(main.settings, "llm_mode", "byok")
    monkeypatch.setattr(main.settings, "openai_api_key", "")
    monkeypatch.setattr(main.settings, "allowed_client_base_urls", "https://api.openai.com/v1")
    with pytest.raises(main.HTTPException) as ex:
        resolve_llm(
            main.LLMOverrides(
                api_key="sk-test",
                base_url="https://evil.example.com/v1",
                model="gpt-4o-mini",
            )
        )
    assert ex.value.status_code == 400
