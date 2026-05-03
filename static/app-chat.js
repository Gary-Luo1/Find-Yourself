function extractVisibleAssistantReply(text) {
  const raw = String(text || "").trim();
  if (!raw) return "我先帮你整理一下。";
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === "object") {
      const reply = parsed.reply || parsed.summary || parsed.follow_up_question || parsed.message || parsed.text || "";
      if (typeof reply === "string" && reply.trim()) return reply.trim();
      return JSON.stringify(parsed, null, 2);
    }
  } catch {
    // not JSON
  }
  return candidate.trim() || raw;
}

function ensureChatWelcome() {
  const thread = normalizeChatThread(getChatThread());
  if (thread.length) return;
  appendChatMessage("assistant", "你好，我是 Find Yourself。你可以先说说当前求职最困扰你的一件事。");
}

function replaceLastAssistantMessage(content, patch = {}) {
  updateLastChatMessage(String(content || ""), patch || {});
}

function setChatBusy(isBusy) {
  const btn = $("btnChatSend");
  const input = $("chatInput");
  if (btn) {
    btn.disabled = Boolean(isBusy);
    btn.textContent = isBusy ? "发送中…" : "发送";
  }
  if (input) input.disabled = Boolean(isBusy);
}

function scrollChatToLatest() {
  const el = $("chatThread");
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

function renderChatThread() {
  const el = $("chatThread");
  if (!el) return;
  const items = normalizeChatThread(getChatThread());
  el.innerHTML = items.map((item) => {
    const roleClass = item.role === "assistant" ? "assistant" : "user";
    const avatar = item.role === "assistant" ? "FY" : "我";
    const typing = item.pending ? `<span class="chat-bubble-meta">正在输入中…</span>` : `<span class="chat-bubble-meta">${escapeHtml(item.time || "")}</span>`;
    return `
      <article class="chat-item ${roleClass}">
        <div class="chat-avatar ${roleClass}">${avatar}</div>
        <div class="chat-bubble-wrap">
          <div class="chat-bubble-content">${textAsHtml(item.content || "")}</div>
          ${typing}
        </div>
      </article>`;
  }).join("");
  scrollChatToLatest();
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
  scrollChatToLatest();
  setChatBusy(true);
  const statusEl = $("chatStatus");
  if (statusEl) statusEl.textContent = "正在发送并等待模型回复…";
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
          replaceLastAssistantMessage("正在输入中…", { pending: true });
          renderChatThread();
          return;
        }
        if (event === "delta") {
          assistantText += String(data?.text || "");
          replaceLastAssistantMessage(assistantText || "正在输入中…", { pending: true });
          renderChatThread();
          return;
        }
        if (event === "final") {
          assistantText = extractVisibleAssistantReply(data?.reply || assistantText || data?.summary || "");
          replaceLastAssistantMessage(assistantText, { pending: false });
          renderChatThread();
          if (data?.message_id) localStorage.setItem("rm_chat_last_message_id", data.message_id);
          scrollChatToLatest();
          return;
        }
        if (event === "memory") return;
        if (event === "error") {
          const msg = friendlyErrorMessage(data?.detail || data?.message || "请求失败，请稍后重试。");
          replaceLastAssistantMessage(msg, { pending: false });
          renderChatThread();
          scrollChatToLatest();
          setStatus(msg, true);
        }
      },
      onDone: () => {},
    });
    return { reply: assistantText };
  } catch (err) {
    const msg = friendlyErrorMessage(err);
    replaceLastAssistantMessage(msg, { pending: false });
    renderChatThread();
    scrollChatToLatest();
    setStatus(msg, true);
    return null;
  } finally {
    if (statusEl) statusEl.textContent = "对话记录已保存在本地。";
    setChatBusy(false);
  }
}

function clearChatHistory() {
  localStorage.removeItem(CHAT_KEY);
  ensureChatWelcome();
  renderChatThread();
}

function bindChatDom() {
  const chatForm = $("chatForm");
  const chatInput = $("chatInput");
  const chatThread = $("chatThread");
  const chatTyping = $("chatTyping");
  const chatStatus = $("chatStatus");
  const sendBtn = $("btnChatSend");
  if (chatThread) {
    ensureChatWelcome();
    renderChatThread();
    renderChatProfile();
  }
  if (chatTyping) chatTyping.classList.add("is-hidden");
  if (chatStatus && !chatStatus.textContent.trim()) chatStatus.textContent = "在下方输入内容后按回车或点击发送。";
  if (sendBtn) {
    sendBtn.disabled = false;
    sendBtn.type = "submit";
  }
  let isSubmitting = false;
  const submitChat = async (e) => {
    if (e) e.preventDefault();
    if (isSubmitting) return;
    const text = String((chatInput && chatInput.value) || "").trim();
    if (!text) {
      setStatus("请先输入你想聊的内容。", true);
      return;
    }
    isSubmitting = true;
    if (chatInput) chatInput.value = "";
    try {
      await sendChatMessage(text);
    } finally {
      isSubmitting = false;
    }
  };
  if (chatForm) chatForm.addEventListener("submit", submitChat);
  if (chatInput) {
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (chatForm && typeof chatForm.requestSubmit === "function") chatForm.requestSubmit();
        else submitChat();
      }
    });
    chatInput.addEventListener("input", () => {
      if (chatStatus && !chatStatus.textContent.includes("正在发送")) chatStatus.textContent = "在下方输入内容后按回车或点击发送。";
    });
  }
}
