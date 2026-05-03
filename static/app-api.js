const FRONTEND_GLOBAL_ROLE_PROMPT = `你是 Find Yourself 产品内的 AI 求职伴侣。
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
6) 若无法完整表格，至少返回可解析 JSON，未知字段填 null。`;

function getDirectModelConfig() {
  return {
    apiKey: String(localStorage.getItem(LS.key) || sessionStorage.getItem(SS.key) || "").trim(),
    baseUrl: String(localStorage.getItem(LS.base) || "").trim().replace(/\/$/, ""),
    model: String(localStorage.getItem(LS.model) || "").trim(),
  };
}

function getSelectedLlmMode() {
  const saved = String(localStorage.getItem(LS.llmMode) || "").trim();
  if (saved) return saved === "direct" ? "direct" : "backend";
  const hasDirectConfig = Boolean((localStorage.getItem(LS.key) || sessionStorage.getItem(SS.key) || "").trim() && (localStorage.getItem(LS.model) || "").trim() && (localStorage.getItem(LS.base) || "").trim());
  return hasDirectConfig ? "direct" : "backend";
}

function isDirectMode() {
  return getSelectedLlmMode() === "direct";
}

function getModelRequestHeaders() {
  const headers = { "Content-Type": "application/json" };
  const { apiKey } = getDirectModelConfig();
  if (isDirectMode() && apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function getModelRequestBody(body) {
  const cfg = getDirectModelConfig();
  if (!isDirectMode()) return body;
  return {
    ...body,
    system_prompt: [FRONTEND_GLOBAL_ROLE_PROMPT, body && body.system_prompt ? String(body.system_prompt) : ""].filter(Boolean).join("\n\n"),
    model: body.model || cfg.model,
    api_key: cfg.apiKey,
    base_url: cfg.baseUrl,
    llm_mode: "direct",
  };
}

function getEffectiveModelConfig() {
  const cfg = getDirectModelConfig();
  return isDirectMode()
    ? { ...cfg, mode: "direct" }
    : { apiKey: "", baseUrl: getApiBaseUrl(), model: String(localStorage.getItem(LS.model) || "").trim(), mode: "backend" };
}

function getModelModeLabel() {
  return isDirectMode() ? "前端直连模式" : "后端模式";
}

function buildValidateLlmBody() {
  const mode = getSelectedLlmMode();
  const cfg = getDirectModelConfig();
  return mode === "direct"
    ? { llm_mode: "direct", api_key: cfg.apiKey, base_url: cfg.baseUrl, model: cfg.model }
    : { llm_mode: "server" };
}

async function testDirectModelConnection() {
  const cfg = getDirectModelConfig();
  if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) {
    throw new Error("前端直连模式需要先填写 API Key、Base URL 和模型名称。");
  }
  const endpoint = cfg.baseUrl.endsWith("/v1") ? `${cfg.baseUrl}/chat/completions` : `${cfg.baseUrl}/v1/chat/completions`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: FRONTEND_GLOBAL_ROLE_PROMPT + "\n你当前任务是连通性检查，仅回复 pong。" },
        { role: "user", content: "ping" },
      ],
      temperature: 0,
    }),
  });
  const raw = await res.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  if (!res.ok) {
    const detail = data.error?.message || data.detail || data.message || data.raw || `HTTP ${res.status}`;
    throw new Error(detail);
  }
  const content = data?.choices?.[0]?.message?.content || data?.output_text || data?.text || raw || "";
  return { ok: true, valid: true, mode: "direct", ping: String(content).slice(0, 120), model: cfg.model };
}

async function postJson(path, body) {
  const controller = new AbortController();
  activeController = controller;
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(apiPath(path), {
      method: "POST",
      headers: getModelRequestHeaders(),
      body: JSON.stringify(getModelRequestBody(body)),
      signal: controller.signal,
    });
    const rawText = await res.text();
    let data = {};
    try { data = rawText ? JSON.parse(rawText) : {}; } catch { data = { raw: rawText }; }
    if (!res.ok) {
      const detail = data.detail || data.message || data.error || data.raw || `HTTP ${res.status}`;
      const err = new Error(detail);
      err.status = res.status;
      err.response = data;
      err.path = path;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
    if (activeController === controller) activeController = null;
  }
}

async function validateLLMConfig() {
  if (isDirectMode()) return testDirectModelConnection();
  return postJson("/api/v1/validate-llm", buildValidateLlmBody());
}

async function streamPostJson(path, body, { onEvent, onDone, onError } = {}) {
  const controller = new AbortController();
  activeController = controller;
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(apiPath(path), {
      method: "POST",
      headers: { ...getModelRequestHeaders(), Accept: "text/event-stream" },
      body: JSON.stringify(getModelRequestBody(body)),
      signal: controller.signal,
    });
    const contentType = String(res.headers.get("content-type") || "");
    if (!res.ok || !contentType.includes("text/event-stream") || !res.body) {
      const raw = await res.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
      const detail = data.detail || data.message || data.error || data.raw || `HTTP ${res.status}`;
      const err = new Error(detail);
      err.status = res.status;
      err.response = data;
      err.path = path;
      throw err;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let eventName = "message";
    let dataLines = [];
    let eventId = "";

    const flush = () => {
      if (!dataLines.length && !eventName) return;
      const payloadText = dataLines.join("\n");
      let payload = payloadText;
      try { payload = JSON.parse(payloadText); } catch {}
      const evt = { event: eventName || "message", id: eventId || "", data: payload };
      if (typeof onEvent === "function") onEvent(evt);
      if (evt.event === "done" && typeof onDone === "function") onDone(evt);
      eventName = "message";
      eventId = "";
      dataLines = [];
    };

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, "");
        buffer = buffer.slice(idx + 1);
        if (!line) {
          flush();
          continue;
        }
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim() || "message";
          continue;
        }
        if (line.startsWith("id:")) {
          eventId = line.slice(3).trim();
          continue;
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
      if (done) break;
    }
    flush();
  } catch (err) {
    if (typeof onError === "function") onError(err);
    throw err;
  } finally {
    clearTimeout(timer);
    if (activeController === controller) activeController = null;
  }
}

function validateInputs(resume, job) {
  if (resume.length < 20 || job.length < 20) {
    setStatus("简历和 JD 都至少需要 20 个字符。", true);
    return false;
  }
  return true;
}

function setLoading(isLoading) {
  const cancelBtn = $("btnCancel");
  if (cancelBtn) cancelBtn.hidden = !isLoading;
  document.body.classList.toggle("is-loading", Boolean(isLoading));
}

function saveHistoryItem(item) {
  try {
    const prev = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    const next = Array.isArray(prev) ? [item, ...prev] : [item];
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next.slice(0, HISTORY_LIMIT)));
  } catch {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([item]));
  }
  renderHistory();
}

function getHistory() {
  try {
    const items = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function getJourneyItems() {
  try {
    const items = JSON.parse(localStorage.getItem(JOURNEY_KEY) || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function saveJourneyItems(items) {
  localStorage.setItem(JOURNEY_KEY, JSON.stringify(items || []));
}

function getJournalItems() {
  try {
    const items = JSON.parse(localStorage.getItem(JOURNAL_KEY) || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function getEmotionEntries() {
  try {
    const items = JSON.parse(localStorage.getItem(EMOTION_KEY) || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function getMemoryState() {
  try {
    const raw = localStorage.getItem("rm_memory_state_v1");
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") throw new Error("bad memory");
    return {
      stable_facts: Array.isArray(parsed.stable_facts) ? parsed.stable_facts : [],
      preferences: Array.isArray(parsed.preferences) ? parsed.preferences : [],
      open_questions: Array.isArray(parsed.open_questions) ? parsed.open_questions : [],
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
    };
  } catch {
    return { stable_facts: [], preferences: [], open_questions: [], summary: "" };
  }
}

function saveMemoryState(state) {
  localStorage.setItem("rm_memory_state_v1", JSON.stringify(state || getMemoryState()));
}

function appendMemoryLog(entry) {
  try {
    const prev = JSON.parse(localStorage.getItem("rm_memory_log_v1") || "[]");
    const next = Array.isArray(prev) ? [entry, ...prev] : [entry];
    localStorage.setItem("rm_memory_log_v1", JSON.stringify(next.slice(0, 20)));
  } catch {
    localStorage.setItem("rm_memory_log_v1", JSON.stringify([entry]));
  }
}

async function syncMemoryToServer(state) {
  try {
    await postJson("/api/v1/memory/save", { client_id: getClientId(), memory_state: state || getMemoryState() });
  } catch {
    /* ignore offline or server unavailable */
  }
}

async function loadServerMemory() {
  try {
    const res = await fetch(apiPath(`/api/v1/memory?client_id=${encodeURIComponent(getClientId())}`));
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.data) {
      saveMemoryState({
        stable_facts: data.data.stable_facts || [],
        preferences: data.data.preferences || [],
        open_questions: data.data.open_questions || [],
        summary: data.data.summary || "",
      });
    }
  } catch {
    /* ignore */
  }
}
