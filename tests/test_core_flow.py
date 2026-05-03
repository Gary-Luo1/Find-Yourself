from fastapi.testclient import TestClient
import pytest

import main
from llm import parse_json_from_llm
from main import _safe_docx_basename, app


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


def test_memory_save_and_get_round_trip():
    client = TestClient(app)
    save_resp = client.post(
        "/api/v1/memory/save",
        json={
            "client_id": "pytest-client",
            "memory": {
                "profile": {
                    "basic_info": {"school": "A 大学"},
                    "career_preferences": {"target_roles": ["后端开发"]},
                },
                "state": {"current_stage": "apply"},
                "summary": "已记录",
            },
        },
    )
    assert save_resp.status_code == 200

    get_resp = client.get("/api/v1/memory", params={"client_id": "pytest-client"})
    assert get_resp.status_code == 200
    data = get_resp.json()["data"]
    assert data["profile"]["basic_info"]["school"] == "A 大学"
    assert data["state"]["current_stage"] == "apply"


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


def test_page_routes_return_html():
    client = TestClient(app)
    for path in ["/", "/chat.html", "/resume.html", "/analyze.html", "/journey.html"]:
        resp = client.get(path)
        assert resp.status_code == 200
        assert "text/html" in resp.headers["content-type"]


def test_chat_endpoint_rejects_empty_message():
    client = TestClient(app)
    resp = client.post("/api/chat", json={"message": "", "client_id": "pytest-client"})
    assert resp.status_code == 400
    assert "请先输入内容" in resp.json()["detail"]


def test_memory_endpoint_defaults_to_default_client():
    client = TestClient(app)
    resp = client.get("/api/v1/memory")
    assert resp.status_code == 200
    data = resp.json()
    assert data["client_id"] == "default"
    assert "profile" in data["data"]
    assert "state" in data["data"]


