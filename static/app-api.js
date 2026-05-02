async function postJson(path, body) {
  const controller = new AbortController();
  activeController = controller;
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(apiPath(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
  return postJson("/api/v1/validate-llm", {});
}

async function streamPostJson(path, body, { onEvent, onDone, onError } = {}) {
  const controller = new AbortController();
  activeController = controller;
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(apiPath(path), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
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
