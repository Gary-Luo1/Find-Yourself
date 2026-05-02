async function loadSettings() {
  return;
}

function renderActiveLlmConfig() {}

function openSettings() {}

function closeSettings() {}

function saveSettings() {
  return true;
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

function extractVisibleAssistantReply(text) {
  const raw = String(text || "").trim();
  if (!raw) return "我先帮你整理一下。";
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === "object") {
      const reply = parsed.reply || parsed.summary || parsed.message || parsed.text || "";
      if (typeof reply === "string" && reply.trim()) return reply.trim();
      return JSON.stringify(parsed, null, 2);
    }
  } catch {
    // ignore and fall back to plain text cleanup
  }
  const cleaned = candidate
    .replace(/^[\s\S]*?"reply"\s*:\s*"/i, "")
    .replace(/"\s*,\s*"summary"[\s\S]*$/i, "")
    .replace(/\\n/g, "\n");
  return cleaned.trim() || raw;
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

function renderChatThread(items) {
  const el = $("chatThread");
  const statusEl = $("chatStatus");
  if (!el) return;
  const thread = normalizeChatThread(items);
  if (statusEl) statusEl.textContent = thread.length ? `对话记录已保存在本地，共 ${thread.length} 条。` : "在下方输入内容后按回车或点击发送。";
  if (!thread.length) {
    el.innerHTML = `<div class="chat-empty"><div class="chat-empty__title">还没有开始对话</div><div class="chat-empty__body">你可以直接说：我现在最想先解决什么求职问题。</div></div>`;
    return;
  }
  el.innerHTML = thread.map((item) => {
    const isAssistant = item.role === "assistant";
    const cls = isAssistant ? "chat-item assistant" : "chat-item user";
    const avatar = isAssistant ? "FY" : "你";
    const pending = item.pending ? `<span class="chat-pending">正在输入中…</span>` : "";
    const content = item.pending ? `${textAsHtml(item.content || "")}<span class="chat-cursor" aria-hidden="true"></span>` : textAsHtml(item.content || "");
    return `
      <article class="${cls}" data-message-id="${escapeHtml(item.id)}">
        <div class="chat-avatar ${isAssistant ? "assistant" : "user"}">${escapeHtml(avatar)}</div>
        <div class="chat-bubble-wrap">
          <div class="chat-meta">${escapeHtml(isAssistant ? "Find Yourself" : "你")} · ${escapeHtml(item.time || "")}${pending}</div>
          <div class="chat-bubble-content">${content}</div>
        </div>
      </article>`;
  }).join("");
  requestAnimationFrame(() => {
    el.scrollTop = el.scrollHeight;
  });
}

function scrollChatToLatest() {
  const el = $("chatThread");
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

function setChatBusy(isBusy) {
  const btn = $("btnChatSend");
  if (btn) btn.disabled = isBusy;
  const seed = $("btnChatSeed");
  if (seed) seed.disabled = isBusy;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractVisibleAssistantReply(value) {
  const text = stripMarkdownFormatting(String(value || ""));
  if (!text) return "我先帮你整理一下。";
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      const reply = stripMarkdownFormatting(String(parsed.reply || parsed.summary || parsed.follow_up_question || ""));
      if (reply) return reply;
    }
  } catch {
    // not JSON
  }
  return text;
}

function startAssistantPlaceholder() {
  appendChatMessage("assistant", "正在输入中…", { pending: true });
  renderChatThread();
}

async function sendChatMessage(message) {
  const text = String(message || "").trim();
  if (!text) return null;
  appendChatMessage("user", text);
  appendChatMessage("assistant", "正在输入中…", { pending: true });
  renderChatThread();
  setChatBusy(true);
  const typingEl = $("chatTyping");
  const statusEl = $("chatStatus");
  if (statusEl) statusEl.textContent = "正在发送并等待模型回复…";
  if (typingEl) typingEl.classList.remove("is-hidden");
  let assistantText = "";
  const memoryState = getMemoryState();
  const requestBody = {
    client_id: getClientId(),
    session_id: localStorage.getItem("rm_chat_session_id") || `s_${Date.now()}`,
    current_page: "chat",
    scene: "onboarding",
    message: text,
    memory: memoryState,
    ...llmPayload(),
  };
  try {
    await streamPostJson("/api/chat", requestBody, {
      onEvent: ({ event, data }) => {
        if (event === "meta") {
          if (data?.session_id) localStorage.setItem("rm_chat_session_id", data.session_id);
          return;
        }
        if (event === "start") {
          assistantText = "";
          updateLastChatMessage("正在输入中…", { pending: true });
          renderChatThread();
          return;
        }
        if (event === "delta") {
          assistantText += String(data?.text || "");
          return;
        }
        if (event === "final") {
          assistantText = extractVisibleAssistantReply(data?.reply || assistantText || data?.summary || "");
          updateLastChatMessage(assistantText, { pending: false });
          renderChatThread();
          if (data?.message_id) localStorage.setItem("rm_chat_last_message_id", data.message_id);
          scrollChatToLatest();
          return;
        }
        if (event === "memory") {
          return;
        }
        if (event === "error") {
          const msg = friendlyErrorMessage(data?.detail || data?.message || "请求失败，请稍后重试。");
          updateLastChatMessage(msg, { pending: false });
          renderChatThread();
          setStatus(msg, true);
        }
      },
      onDone: () => {},
    });
    return { reply: assistantText };
  } catch (err) {
    const msg = friendlyErrorMessage(err);
    updateLastChatMessage(msg, { pending: false });
    renderChatThread();
    setStatus(msg, true);
    return null;
  } finally {
    if (typingEl) typingEl.classList.add("is-hidden");
    if (statusEl) statusEl.textContent = "对话记录已保存在本地。";
    setChatBusy(false);
  }
}

function clearChatHistory() {
  localStorage.removeItem(CHAT_KEY);
  ensureChatWelcome();
  renderChatThread();
}

function clearDraft() {
  [DRAFT.resume, DRAFT.job, DRAFT.jobMulti, DRAFT.customConcern].forEach((key) => localStorage.removeItem(key));
  clearValues(["resume", "job", "customConcern"]);
  if (typeof ensureVisibleMultiJobCount === "function") ensureVisibleMultiJobCount(MIN_MULTI_JD_VISIBLE);
}

function readJsonStorage(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    return Array.isArray(fallback) ? (Array.isArray(parsed) ? parsed : fallback) : (parsed && typeof parsed === "object" ? parsed : fallback);
  } catch {
    return fallback;
  }
}

function getJourneyItems() { return readJsonStorage(JOURNEY_KEY, []); }
function saveJourneyItems(items) { localStorage.setItem(JOURNEY_KEY, JSON.stringify(Array.isArray(items) ? items : [])); }
function getJournalItems() { return readJsonStorage(JOURNAL_KEY, []); }
function saveJournalItems(items) { localStorage.setItem(JOURNAL_KEY, JSON.stringify(Array.isArray(items) ? items : [])); }

const JOURNEY_STAGES = [
  ["direction", "方向探索"],
  ["resume", "简历准备"],
  ["apply", "投递推进"],
  ["interview", "面试准备"],
  ["review", "面试复盘"],
];

function inferJourneyStage() {
  const { resume, job, journey, journal } = getJourneyContext();
  if (!resume) return "direction";
  if (!job) return "resume";
  if (journey.some((x) => !x.done)) return "apply";
  if (journal.length) return "review";
  return "interview";
}

function renderJourneyStage() {
  const el = $("journeyStage");
  if (!el) return;
  const active = inferJourneyStage();
  el.innerHTML = JOURNEY_STAGES.map(([id, label]) => `<div class="journey-stage__item ${id === active ? "active" : ""}"><span>${escapeHtml(label)}</span></div>`).join("");
}

function renderJourneyBoard() {
  const el = $("journeyBoard");
  if (!el) return;
  const items = getJourneyItems();
  if (!items.length) {
    el.innerHTML = `<div class="journey-empty">先添加 1-3 件今天最重要的事，比如“改一版简历”“投递 3 个岗位”。</div>`;
    return;
  }
  el.innerHTML = items.map((item, i) => `
    <label class="journey-item ${item.done ? "done" : ""}">
      <input type="checkbox" data-journey-done="${i}" ${item.done ? "checked" : ""} />
      <div>
        <div class="journey-item__text">${escapeHtml(item.text)}</div>
        <div class="journey-item__meta">${escapeHtml(item.time || nowLabel())}</div>
      </div>
    </label>`).join("");
  el.querySelectorAll("[data-journey-done]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const idx = Number(cb.getAttribute("data-journey-done"));
      const next = getJourneyItems();
      if (next[idx]) next[idx].done = cb.checked;
      saveJourneyItems(next);
      renderJourneyBoard();
      renderJourneyStage();
      renderWeeklyReview();
    });
  });
}

function renderWeeklyReview() {
  const el = $("weeklyReview");
  if (!el) return;
  const { journey, journal } = getJourneyContext();
  const doneCount = journey.filter((x) => x.done).length;
  el.innerHTML = `<div class="weekly-review"><strong>当前进度</strong><p>今日行动 ${doneCount}/${journey.length || 0}，复盘记录 ${journal.length} 条。</p><p>建议你优先把未完成的 1-2 件事做完，再做一次简短复盘。</p></div>`;
}

function renderJournalList() {
  const el = $("journalList");
  if (!el) return;
  const items = getJournalItems();
  if (!items.length) {
    el.innerHTML = `<div class="journey-empty">这里会显示最近的复盘记录。</div>`;
    return;
  }
  el.innerHTML = items.map((item) => `
    <article class="journal-card">
      <div class="journal-card__head">${escapeHtml(item.time || nowLabel())}</div>
      <div class="journal-card__body">
        <div><strong>阻碍：</strong>${escapeHtml(item.blockers || "—")}</div>
        <div><strong>学到：</strong>${escapeHtml(item.learned || "—")}</div>
        <div><strong>明天：</strong>${escapeHtml(item.next || "—")}</div>
      </div>
    </article>`).join("");
}

function addJourneyAction() {
  const input = $("journeyInput");
  const text = String((input && input.value) || "").trim();
  if (!text) return;
  const next = getJourneyItems();
  next.unshift({ text, done: false, time: nowLabel() });
  saveJourneyItems(next.slice(0, 10));
  if (input) input.value = "";
  renderJourneyBoard();
  renderJourneyStage();
  renderWeeklyReview();
}

function clearJourneyBoard() {
  saveJourneyItems([]);
  renderJourneyBoard();
  renderJourneyStage();
  renderWeeklyReview();
}

function saveJournalEntry() {
  const blockers = String(($("journalBlockers") && $("journalBlockers").value) || "").trim();
  const learned = String(($("journalLearned") && $("journalLearned").value) || "").trim();
  const next = String(($("journalNext") && $("journalNext").value) || "").trim();
  if (!blockers && !learned && !next) return setStatus("请先写一点复盘内容。", true);
  const items = getJournalItems();
  items.unshift({ time: nowLabel(), blockers, learned, next });
  saveJournalItems(items.slice(0, 20));
  renderJournalList();
  renderWeeklyReview();
  setStatus("复盘已保存。", false);
}

function clearJournal() {
  ["journalBlockers", "journalLearned", "journalNext"].forEach((id) => { const el = $(id); if (el) el.value = ""; });
}

function resetJourney() {
  clearJourneyBoard();
  saveJournalItems([]);
  clearJournal();
  renderJournalList();
  renderWeeklyReview();
}
