async function loadSettings() {
  return;
}

function renderActiveLlmConfig() {}

function openSettings() {}

function closeSettings() {}

function saveSettings() {
  return true;
}

function escapeText(html) {
  return (window.AppShared && typeof AppShared.escapeHtml === "function")
    ? AppShared.escapeHtml(html)
    : String(html || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function textAsHtmlSafe(text) {
  if (window.AppShared && typeof AppShared.textAsHtml === "function") return AppShared.textAsHtml(text);
  return escapeText(text).replace(/\n/g, "<br />");
}

function getClientId() {
  let clientId = localStorage.getItem("rm_client_id");
  if (!clientId) {
    clientId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem("rm_client_id", clientId);
  }
  return clientId;
}

function nowLabel() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getValue(id) {
  const el = $(id);
  return el ? String(el.value || "") : "";
}

function setValue(id, value) {
  const el = $(id);
  if (el) el.value = value;
}

function clearValues(ids) {
  ids.forEach((id) => setValue(id, ""));
}

function llmPayload() {
  return { client_id: getClientId() };
}

function memoryPayload() {
  return { memory_state: getMemoryState(), client_id: getClientId() };
}

function openMemoryDialog() {
  const dlg = $("dlgMemory");
  if (dlg && typeof dlg.showModal === "function") dlg.showModal();
}

function resetMemory() {
  saveMemoryState({ stable_facts: [], preferences: [], open_questions: [], summary: "" });
  setStatus("画像已重置。", false);
}

function openEmotionDialog() {
  const dlg = $("dlgEmotion");
  if (dlg && typeof dlg.showModal === "function") dlg.showModal();
}

function setStatus(msg, isError) {
  const el = $("status") || $("configStatus");
  const errEl = $("statusError") || $("configStatus");
  if (el) {
    if (isError) {
      if (errEl === el) {
        el.textContent = msg || "";
      } else {
        el.textContent = "";
      }
    } else {
      el.textContent = msg || "";
    }
    el.classList.remove("error");
    if (isError) el.classList.add("error");
  }
  if (errEl && errEl !== el) errEl.textContent = isError ? msg || "" : "";
}

function friendlyErrorMessage(err) {
  const raw = String((err && err.message) || err || "");
  const lower = raw.toLowerCase();
  if (lower.includes("timeout") || raw.includes("超时")) return "请求超时：建议重试，或换更快模型并减少输入长度。";
  if (raw.includes("无法连接模型服务") || lower.includes("failed to fetch")) return "网络连接失败：请检查 Base URL、网络和模型服务可用性后重试。";
  if (raw.includes("API Key") || raw.includes("401") || raw.includes("403")) return "鉴权失败：请检查 API Key、Base URL 与模型名称配置。";
  return raw || "请求失败，请稍后重试。";
}

function loadDraft() {
  const resume = localStorage.getItem(DRAFT.resume) || "";
  const job = localStorage.getItem(DRAFT.job) || "";
  const jobMulti = localStorage.getItem(DRAFT.jobMulti) || "";
  const customConcern = localStorage.getItem(DRAFT.customConcern) || "";
  const assignIfExists = (id, value) => { const el = $(id); if (el) el.value = value; };
  assignIfExists("resume", resume);
  assignIfExists("job", job);
  assignIfExists("customConcern", customConcern);
  if (typeof applyMultiJobsFromSerialized === "function") applyMultiJobsFromSerialized(jobMulti);
  if (typeof updateOnboardingBanner === "function") updateOnboardingBanner();
  if (resume || job || jobMulti || customConcern) setStatus("已恢复上次输入。");
}

function saveDraft() {
  const multiJobs = typeof getMultiJobValues === "function" ? getMultiJobValues() : [];
  localStorage.setItem(DRAFT.resume, getValue("resume"));
  localStorage.setItem(DRAFT.job, getValue("job"));
  localStorage.setItem(DRAFT.jobMulti, typeof serializeMultiJobs === "function" ? serializeMultiJobs(multiJobs) : "");
  localStorage.setItem(DRAFT.customConcern, getValue("customConcern"));
}

function getChatThread() { return readJsonStorage(CHAT_KEY, []); }
function saveChatThread(items) { writeJsonStorage(CHAT_KEY, Array.isArray(items) ? items : []); }

function getChatProfile() {
  const parsed = readJsonStorage("rm_chat_profile_v1", {});
  return {
    stable_facts: Array.isArray(parsed.stable_facts) ? parsed.stable_facts : [],
    preferences: Array.isArray(parsed.preferences) ? parsed.preferences : [],
    open_questions: Array.isArray(parsed.open_questions) ? parsed.open_questions : [],
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
  };
}

function saveChatProfile(profile) {
  const next = {
    stable_facts: Array.isArray(profile?.stable_facts) ? profile.stable_facts : [],
    preferences: Array.isArray(profile?.preferences) ? profile.preferences : [],
    open_questions: Array.isArray(profile?.open_questions) ? profile.open_questions : [],
    summary: typeof profile?.summary === "string" ? profile.summary : "",
  };
  writeJsonStorage("rm_chat_profile_v1", next);
  saveMemoryState(next);
  renderChatProfile(next);
}

function renderChatProfile(profile = getChatProfile()) {
  const summaryEl = $("chatProfileSummary");
  const tagsEl = $("chatProfileTags");
  const summary = String(profile?.summary || "").trim();
  if (summaryEl) {
    summaryEl.textContent = summary || "我会根据你的聊天内容，逐步整理出你的偏好、经历和待确认问题。";
  }
  if (tagsEl) {
    const tags = [
      ...(profile?.preferences || []).slice(0, 3),
      ...(profile?.stable_facts || []).slice(0, 2),
    ].filter(Boolean).slice(0, 5);
    tagsEl.innerHTML = tags.length
      ? tags.map((t) => `<span class="profile-tag">${escapeHtml(String(t))}</span>`).join("")
      : `<span class="profile-tag">等待你的第一条对话</span>`;
  }
}

function appendChatMessage(role, content, extra = {}) {
  const thread = getChatThread();
  const item = {
    id: extra.id || `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    time: extra.time || nowLabel(),
    pending: Boolean(extra.pending),
  };
  thread.push(item);
  saveChatThread(thread.slice(-50));
  return item;
}

function updateLastChatMessage(content, patch = {}) {
  const thread = getChatThread();
  const idx = [...thread].reverse().findIndex((item) => item.role === "assistant");
  if (idx >= 0) thread[thread.length - 1 - idx] = { ...thread[thread.length - 1 - idx], content, ...patch };
  saveChatThread(thread.slice(-50));
}

function normalizeChatThread(items = getChatThread()) {
  const list = Array.isArray(items) ? items : [];
  return list
    .map((item) => ({
      id: item.id || `m_${Math.random().toString(36).slice(2, 8)}`,
      role: item.role === "assistant" ? "assistant" : "user",
      content: String(item.content || ""),
      time: String(item.time || ""),
      pending: Boolean(item.pending),
    }))
    .filter((item) => item.content || item.pending);
}

function clearDraft() {
  [DRAFT.resume, DRAFT.job, DRAFT.jobMulti, DRAFT.customConcern].forEach((key) => localStorage.removeItem(key));
  clearValues(["resume", "job", "customConcern"]);
  if (typeof ensureVisibleMultiJobCount === "function") ensureVisibleMultiJobCount(MIN_MULTI_JD_VISIBLE);
}

function saveMemoryState(state) {
  const next = state && typeof state === "object"
    ? {
        stable_facts: Array.isArray(state.stable_facts) ? state.stable_facts : [],
        preferences: Array.isArray(state.preferences) ? state.preferences : [],
        open_questions: Array.isArray(state.open_questions) ? state.open_questions : [],
        summary: typeof state.summary === "string" ? state.summary : "",
      }
    : { stable_facts: [], preferences: [], open_questions: [], summary: "" };
  localStorage.setItem("rm_memory_state_v1", JSON.stringify(next));
  return next;
}

function getMemoryState() {
  try {
    const raw = localStorage.getItem("rm_memory_state_v1");
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") throw new Error("bad memory");
    return saveMemoryState(parsed);
  } catch {
    return saveMemoryState({ stable_facts: [], preferences: [], open_questions: [], summary: "" });
  }
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

function getEmotionEntries() {
  try {
    const items = JSON.parse(localStorage.getItem(EMOTION_KEY) || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function readJsonStorage(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    return Array.isArray(fallback) ? (Array.isArray(parsed) ? parsed : fallback) : (parsed && typeof parsed === "object" ? parsed : fallback);
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
