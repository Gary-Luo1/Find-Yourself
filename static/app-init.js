function initSharedUi() {
  const safeLoadDraft = typeof loadDraft === "function" ? loadDraft : () => {};
  const safeUpdateFlowNav = typeof updateFlowNav === "function" ? updateFlowNav : () => {};
  const safeBindFlowActions = typeof bindFlowActions === "function" ? bindFlowActions : () => {};
  safeLoadDraft();
  safeUpdateFlowNav();
  safeBindFlowActions();

  const wire = (id, fn) => {
    const el = $(id);
    if (el) el.addEventListener("click", fn);
  };

  wire("btnMemoryClear", () => {
    fillMemoryEditor({ stable_facts: [], preferences: [], open_questions: [], summary: "" });
  });

  wire("btnMemorySave", () => {
    const state = readMemoryEditor();
    saveMemoryState(state);
    appendMemoryLog({ type: "memory", time: nowLabel(), summary: state.summary || "" });
    syncMemoryToServer(state);
    const d = $("dlgMemory");
    if (d && typeof d.close === "function") d.close();
    setStatus("画像已保存。", false);
  });

  wire("btnEmotionClear", () => {
    if ($("emotionInput")) $("emotionInput").value = "";
    if ($("emotionTakeaway")) $("emotionTakeaway").value = "";
  });

  wire("btnEmotionSave", () => {
    const text = String($("emotionInput")?.value || "").trim();
    const takeaway = String($("emotionTakeaway")?.value || "").trim();
    if (!text && !takeaway) {
      setStatus("请先写一点内容再保存。", true);
      return;
    }
    const entries = getEmotionEntries();
    entries.unshift({ time: nowLabel(), tag: "情绪记录", tone: text.slice(0, 120), takeaway: takeaway.slice(0, 120) });
    localStorage.setItem(EMOTION_KEY, JSON.stringify(entries.slice(0, 20)));
    appendMemoryLog({ type: "emotion", time: nowLabel(), tone: text.slice(0, 120), takeaway: takeaway.slice(0, 120) });
    const d = $("dlgEmotion");
    if (d && typeof d.close === "function") d.close();
    setStatus("情绪已记录。", false);
  });

  wire("btnHistoryClear", () => { clearHistory(); });
  wire("btnMemoryEdit", () => { const d = $("dlgMemory"); if (d && typeof d.showModal === "function") d.showModal(); });
  wire("btnEmotionOpen", () => { const d = $("dlgEmotion"); if (d && typeof d.showModal === "function") d.showModal(); });
  wire("btnHeroJourney", () => setFlowStep("journey"));
  wire("btnDemoFill", () => { fillDemoData(); setFlowStep("analyze"); });
  wire("btnDemoClear", () => { clearDemoData(); setFlowStep("chat"); });
  wire("btnDraftSave", () => { saveDraft(true); setStatus("草稿已保存。", false); });
  wire("btnDraftClear", () => { clearDraft(); setStatus("内容已清空。", false); setFlowStep("chat"); });
  if (location.pathname.endsWith("/journey.html")) {
    renderJourneyBoard();
    renderJourneyStage();
    renderWeeklyReview();
    renderJournalList();
  }

  const fileResume = $("fileResume");
  if (fileResume) {
    fileResume.addEventListener("change", async () => {
      const file = fileResume.files && fileResume.files[0];
      if (!file) return;
      setStatus("正在解析简历文件…", false);
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/v1/extract-text", { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || data.message || `HTTP ${res.status}`);
        const text = String(data?.data?.text || "").trim();
        if (!text) throw new Error("文件解析成功，但没有提取到文本。");
        const resumeEl = $("resume");
        if (resumeEl) resumeEl.value = text;
        saveDraft(true);
        setStatus("简历已解析并填入文本框。", false);
      } catch (err) {
        setStatus(friendlyErrorMessage(err), true);
      } finally {
        fileResume.value = "";
      }
    });
  }

  const chatForm = $("chatForm");
  const chatThread = $("chatThread");
  if (chatThread) {
    ensureChatWelcome();
    renderChatThread();
    renderChatProfile();
  }
  if (chatForm && typeof sendChatMessage === "function") {
    chatForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = $("chatInput");
      const text = String((input && input.value) || "").trim();
      if (!text) return;
      if (input) input.value = "";
      await sendChatMessage(text);
    });
  }

  if (location.pathname.endsWith("/chat.html")) {
    setFlowStep("chat", { persist: true, replace: false });
  } else if (location.pathname.endsWith("/resume.html")) {
    setFlowStep("resume", { persist: true, replace: false });
  } else if (location.pathname.endsWith("/analyze.html")) {
    setFlowStep("analyze", { persist: true, replace: false });
  } else if (location.pathname.endsWith("/journey.html")) {
    setFlowStep("journey", { persist: true, replace: false });
  }
}

function ensureHoverChatWidget() {
  if (location.pathname.endsWith("/chat.html")) return;
  if ($("floatingChatEntry") || $("hoverChatWidget")) return;

  const widget = document.createElement("div");
  widget.id = "hoverChatWidget";
  widget.className = "hover-chat-widget";
  widget.innerHTML = `
    <button type="button" class="floating-chat-entry" id="floatingChatEntry" aria-label="打开聊聊">聊聊</button>
    <div class="hover-chat-popover" id="hoverChatPopover" aria-hidden="true">
      <div class="hover-chat-head">
        <div>
          <div class="hover-chat-title">Find Yourself 聊聊</div>
          <div class="hover-chat-subtitle">悬停即可快速提问</div>
        </div>
        <button type="button" class="hover-chat-close" id="hoverChatClose" aria-label="关闭">×</button>
      </div>
      <div class="hover-chat-thread" id="hoverChatThread"></div>
      <form class="hover-chat-form" id="hoverChatForm">
        <input id="hoverChatInput" type="text" placeholder="直接问我一个问题" />
        <button type="submit" class="btn btn-primary btn-compact">发送</button>
      </form>
    </div>`;
  document.body.appendChild(widget);

  const popover = $("hoverChatPopover");
  const entry = $("floatingChatEntry");
  const close = $("hoverChatClose");
  const form = $("hoverChatForm");
  const input = $("hoverChatInput");
  const thread = $("hoverChatThread");
  const show = () => { widget.classList.add("is-open"); if (popover) popover.setAttribute("aria-hidden", "false"); };
  const hide = () => { widget.classList.remove("is-open"); if (popover) popover.setAttribute("aria-hidden", "true"); };
  let hideTimer = null;
  const scheduleHide = () => { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 180); };
  const cancelHide = () => { clearTimeout(hideTimer); };

  [entry, popover].forEach((el) => {
    if (!el) return;
    el.addEventListener("mouseenter", () => { cancelHide(); show(); });
    el.addEventListener("mouseleave", scheduleHide);
  });
  if (entry) entry.addEventListener("click", (e) => { e.preventDefault(); widget.classList.toggle("is-open"); if (widget.classList.contains("is-open")) show(); else hide(); });
  if (close) close.addEventListener("click", hide);
  if (entry) entry.addEventListener("focus", show);
  if (input) input.addEventListener("focus", show);
  if (form && typeof sendChatMessage === "function") {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = String(input?.value || "").trim();
      if (!text) return;
      if (thread) thread.innerHTML = `<div class="hover-chat-msg hover-chat-msg--user">${escapeHtml(text)}</div><div class="hover-chat-msg hover-chat-msg--assistant">正在思考…</div>`;
      if (input) input.value = "";
      const reply = await sendChatMessage(text);
      if (thread && reply && reply.reply) {
        thread.innerHTML = `<div class="hover-chat-msg hover-chat-msg--user">${escapeHtml(text)}</div><div class="hover-chat-msg hover-chat-msg--assistant">${textAsHtml(reply.reply)}</div>`;
      }
    });
  }
  widget.addEventListener("mouseenter", cancelHide);
  widget.addEventListener("mouseleave", scheduleHide);
}

document.addEventListener("DOMContentLoaded", () => {
  initSharedUi();
  ensureHoverChatWidget();
  if (location.hostname.endsWith("vercel.app")) {
    window.__API_BASE_URL__ = localStorage.getItem("rm_api_base_url_override") || "";
  }
});
