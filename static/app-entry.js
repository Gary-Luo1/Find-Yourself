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
  if (typeof initSharedUi === "function") initSharedUi();
  ensureHoverChatWidget();
  const settingsBtn = $("btnOpenSettings");
  if (settingsBtn) {
    settingsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (typeof openSettingsDialog === "function") {
        const opened = openSettingsDialog();
        if (opened) return;
      }
      const dlg = $("dlgSettings");
      if (dlg) dlg.setAttribute("open", "open");
    });
  }
  if (new URLSearchParams(location.search).get("open") === "settings") {
    if (typeof openSettingsDialog === "function") setTimeout(openSettingsDialog, 0);
    else {
      const dlg = $("dlgSettings");
      if (dlg) setTimeout(() => dlg.setAttribute("open", "open"), 0);
    }
  }
  if (location.hostname.endsWith("vercel.app")) {
    window.__API_BASE_URL__ = localStorage.getItem("rm_api_base_url_override") || "";
  }
});
