function openSettingsDialog() {
  const dlg = $("dlgSettings");
  if (!dlg) return false;
  if (typeof dlg.showModal === "function") {
    if (!dlg.open) dlg.showModal();
  } else {
    dlg.setAttribute("open", "open");
  }
  return true;
}

function closeSettingsDialog() {
  const dlg = $("dlgSettings");
  if (!dlg) return false;
  if (typeof dlg.close === "function") dlg.close();
  else dlg.removeAttribute("open");
  return true;
}

if (typeof window !== "undefined") window.openSettingsDialog = openSettingsDialog;

function refreshSettingsPageState() {
  const el = $("settingsPageResult");
  if (!el) return;
  const mode = getSelectedLlmMode();
  const cfg = getDirectModelConfig();
  const backendBase = String(getApiBaseUrl() || "").trim() || "当前站点";
  const lines = [
    `后端模式：${backendBase}`,
    `前端模式：${cfg.apiKey && cfg.baseUrl && cfg.model ? "已填写" : "未完整填写"}`,
    `当前选中：${mode === "direct" ? "前端直连" : "后端"}`,
  ];
  el.textContent = lines.join("\n");
}

function initSharedUi() {
  if (window.__APP_SHARED_UI_INIT_DONE__) return;
  window.__APP_SHARED_UI_INIT_DONE__ = true;
  const params = new URLSearchParams(location.search);
  if (params.get("open") === "settings" || params.get("step") === "settings") {
    window.__OPEN_SETTINGS_ON_LOAD__ = true;
  }
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

  const apiBaseInput = $("apiBaseUrlInput");
  const apiKeyInput = $("apiKeyInput");
  const apiModelInput = $("apiModelInput");
  const apiModelBaseInput = $("apiModelBaseInput");
  const llmModeSelect = $("llmModeSelect");
  const settingsHint = $("settingsHint");
  const settingsResult = $("settingsResult");
  const backendFields = $("backendFields");
  const directFields = $("directFields");
  const writeSettingsResult = (text, isError = false) => {
    if (settingsResult) {
      settingsResult.textContent = text || "";
      settingsResult.classList.toggle("error", Boolean(isError));
    }
  };
  const refreshSettingsHint = () => {
    if (!settingsHint) return;
    const mode = llmModeSelect ? llmModeSelect.value : (localStorage.getItem(LS.llmMode) || "backend");
    settingsHint.textContent = mode === "direct"
      ? "当前为前端直连模式：配置会保存在本地并直接请求模型服务。"
      : "当前为后端模式：页面会通过你的后端统一调用模型。";
  };
  const refreshSettingsPageState = () => {
    const mode = llmModeSelect ? llmModeSelect.value : (localStorage.getItem(LS.llmMode) || "direct");
    if (backendFields) backendFields.style.display = mode === "backend" ? "block" : "none";
    if (directFields) directFields.style.display = mode === "direct" ? "block" : "none";
  };
  if (apiBaseInput) apiBaseInput.value = getApiBaseUrl() || "";
  if (apiKeyInput) apiKeyInput.value = localStorage.getItem(LS.key) || sessionStorage.getItem(SS.key) || "";
  if (apiModelInput) apiModelInput.value = localStorage.getItem(LS.model) || "";
  if (apiModelBaseInput) apiModelBaseInput.value = localStorage.getItem(LS.base) || "";
  const savedMode = localStorage.getItem(LS.llmMode) || "";
  const hasDirectConfig = Boolean((apiKeyInput && apiKeyInput.value.trim()) && (apiModelInput && apiModelInput.value.trim()) && (apiModelBaseInput && apiModelBaseInput.value.trim()));
  if (llmModeSelect) llmModeSelect.value = savedMode || (hasDirectConfig ? "direct" : "direct");
  refreshSettingsHint();
  refreshSettingsPageState();
  if (llmModeSelect) llmModeSelect.addEventListener("change", () => { refreshSettingsHint(); refreshSettingsPageState(); });
  const settingsDoneBtn = $("btnSettingsDone");
  if (settingsDoneBtn) {
    settingsDoneBtn.addEventListener("click", () => {
      if (apiBaseInput) setApiBaseUrl(apiBaseInput.value);
      if (apiKeyInput) localStorage.setItem(LS.key, apiKeyInput.value.trim());
      if (apiModelInput) localStorage.setItem(LS.model, apiModelInput.value.trim());
      if (apiModelBaseInput) localStorage.setItem(LS.base, apiModelBaseInput.value.trim());
      if (llmModeSelect) localStorage.setItem(LS.llmMode, llmModeSelect.value);
      const msg = `${getModelModeLabel()} 已保存。`;
      writeSettingsResult(msg, false);
      setStatus(msg, false);
      closeSettingsDialog();
      location.href = "/chat.html";
    });
  }
  const runConnectionTest = async () => {
    const testBtn = $("btnTestConnection");
    const oldText = testBtn ? testBtn.textContent : "";
    writeSettingsResult("正在测试连接…", false);
    setStatus("正在测试连接…", false);
    try {
      if (testBtn) {
        testBtn.disabled = true;
        testBtn.textContent = "测试中…";
      }
      await validateLLMConfig();
      const okText = "连接成功";
      writeSettingsResult(okText, false);
      setStatus(okText, false);
      refreshSettingsHint();
    } catch (err) {
      const msg = friendlyErrorMessage(err);
      writeSettingsResult(msg, true);
      setStatus(msg, true);
    } finally {
      if (testBtn) {
        testBtn.disabled = false;
        testBtn.textContent = oldText || "测试连接";
      }
    }
  };
  wire("btnTestBackendConnection", () => {
    if (llmModeSelect) llmModeSelect.value = "backend";
    refreshSettingsHint();
    refreshSettingsPageState();
    runConnectionTest();
  });
  wire("btnTestDirectConnection", () => {
    if (llmModeSelect) llmModeSelect.value = "direct";
    refreshSettingsHint();
    refreshSettingsPageState();
    runConnectionTest();
  });
  wire("btnTestBackendConnection", () => {
    if (llmModeSelect) llmModeSelect.value = "backend";
    refreshSettingsHint();
    refreshSettingsPageState();
    runConnectionTest();
  });
  wire("btnTestDirectConnection", () => {
    if (llmModeSelect) llmModeSelect.value = "direct";
    refreshSettingsHint();
    refreshSettingsPageState();
    runConnectionTest();
  });
  wire("btnTestConnection", () => { runConnectionTest(); });
  wire("btnSettingsDone", () => {
    if (apiBaseInput) setApiBaseUrl(apiBaseInput.value);
    if (apiKeyInput) localStorage.setItem(LS.key, apiKeyInput.value.trim());
    if (apiModelInput) localStorage.setItem(LS.model, apiModelInput.value.trim());
    if (apiModelBaseInput) localStorage.setItem(LS.base, apiModelBaseInput.value.trim());
    if (llmModeSelect) localStorage.setItem(LS.llmMode, llmModeSelect.value);
    const d = $("dlgSettings");
    if (d && typeof d.close === "function") d.close();
    const msg = `${getModelModeLabel()} 已保存，正在进入聊天。`;
    writeSettingsResult(msg, false);
    setStatus(msg, false);
    location.href = "/chat.html";
  });
  const testBtnEl = $("btnTestConnection");
  if (testBtnEl) {
    testBtnEl.addEventListener("pointerdown", () => {
      writeSettingsResult("正在测试连接…", false);
      setStatus("正在测试连接…", false);
    });
  }

  const finishSettings = () => {
    if (apiBaseInput) setApiBaseUrl(apiBaseInput.value);
    if (apiKeyInput) localStorage.setItem(LS.key, apiKeyInput.value.trim());
    if (apiModelInput) localStorage.setItem(LS.model, apiModelInput.value.trim());
    if (apiModelBaseInput) localStorage.setItem(LS.base, apiModelBaseInput.value.trim());
    if (llmModeSelect) localStorage.setItem(LS.llmMode, llmModeSelect.value);
    closeSettingsDialog();
    const msg = `${getModelModeLabel()} 已保存。`;
    writeSettingsResult(msg, false);
    setStatus(msg, false);
    setFlowStep("chat", { persist: true, replace: false });
  };
  wire("btnSettingsDone", finishSettings);
  wire("btnSaveSettings", finishSettings);
  wire("btnResetApiBaseUrl", () => {
    if (apiBaseInput) apiBaseInput.value = "";
    setApiBaseUrl("");
    if (apiKeyInput) apiKeyInput.value = "";
    if (apiModelInput) apiModelInput.value = "";
    if (apiModelBaseInput) apiModelBaseInput.value = "";
    if (llmModeSelect) llmModeSelect.value = "backend";
    localStorage.removeItem(LS.key);
    localStorage.removeItem(LS.base);
    localStorage.removeItem(LS.model);
    localStorage.removeItem(LS.llmMode);
    sessionStorage.removeItem(SS.key);
    refreshSettingsHint();
    writeSettingsResult("模型设置已恢复默认。", false);
    setStatus("模型设置已恢复默认。", false);
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
  wire("btnChatHistoryView", async () => {
    const dlg = $("dlgChatHistory");
    const contentEl = $("chatHistoryContent");
    if (!dlg || !contentEl) return;
    try {
      const localItems = JSON.parse(localStorage.getItem("rm_chat_thread_v1") || "[]");
      const localText = Array.isArray(localItems) && localItems.length
        ? localItems.map((m) => `[${m.time || "--:--"}] ${m.role === "assistant" ? "AI" : "我"}: ${m.content || ""}`).join("\n\n")
        : "本地浏览器暂无聊天记录。";

      contentEl.textContent = localText;
    } catch {
      contentEl.textContent = "读取聊天记录失败，请稍后重试。";
    }

    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "open");
  });
  wire("btnCloseChatHistory", () => {
    const dlg = $("dlgChatHistory");
    if (!dlg) return;
    if (typeof dlg.close === "function") dlg.close();
    else dlg.removeAttribute("open");
  });
  wire("btnOpenSettings", (e) => { e.preventDefault(); openSettingsDialog(); });
  wire("btnMemoryEdit", () => { const d = $("dlgMemory"); if (d && typeof d.showModal === "function") d.showModal(); });
  wire("btnEmotionOpen", () => { const d = $("dlgEmotion"); if (d && typeof d.showModal === "function") d.showModal(); });
  wire("btnHeroJourney", () => setFlowStep("journey"));
  wire("btnDemoFill", () => { fillDemoData(); setFlowStep("analyze"); });
  wire("btnDemoClear", () => { clearDemoData(); setFlowStep("chat"); });
  wire("btnResumeAnalyze", () => {
    saveDraft(true);
    setStatus("已保存，正在进入分析页面。", false);
    location.href = "/analyze.html";
  });
  wire("btnResumeJourney", () => {
    saveDraft(true);
    setStatus("已保存，正在进入旅程页面。", false);
    location.href = "/journey.html";
  });
  wire("btnDraftSave", () => {
    saveDraft(true);
    setStatus("草稿已保存在当前浏览器。", false);
  });
  wire("btnDraftClear", () => {
    clearDraft();
    setStatus("已一键清空 JD 与简历内容。", false);
  });
  wire("btnCareerPlan", () => { runCareerPlan(); });
  wire("btnAnalyze", () => { runAnalyze(); });
  wire("btnTailor", () => { runTailor(); });
  wire("btnInterviewSim", () => { runInterviewSim(); });
  if (location.pathname.endsWith("/journey.html")) {
    renderJourneyBoard();
    renderJourneyStage();
    renderWeeklyReview();
    renderJournalList();
  }

  const fileJob = $("fileJob");
  if (fileJob) {
    fileJob.addEventListener("change", async () => {
      const file = fileJob.files && fileJob.files[0];
      if (!file) return;
      setStatus("正在解析 JD 文件…", false);
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/v1/extract-text", { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || data.message || `HTTP ${res.status}`);
        const text = String(data?.data?.text || "").trim();
        if (!text) throw new Error("文件解析成功，但没有提取到文本。");
        const jobEl = $("job");
        if (jobEl) jobEl.value = text;
        saveDraft(true);
        setStatus("JD 已解析并填入文本框。", false);
      } catch (err) {
        setStatus(friendlyErrorMessage(err), true);
      } finally {
        fileJob.value = "";
      }
    });
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

  if (typeof bindChatDom === "function") bindChatDom();

  if (location.pathname.endsWith("/chat.html")) {
    setFlowStep("chat", { persist: true, replace: false });
    if (window.__OPEN_SETTINGS_ON_LOAD__) {
      requestAnimationFrame(() => requestAnimationFrame(openSettingsDialog));
      window.__OPEN_SETTINGS_ON_LOAD__ = false;
    }
  } else if (location.pathname.endsWith("/resume.html")) {
    setFlowStep("resume", { persist: true, replace: false });
  } else if (location.pathname.endsWith("/analyze.html")) {
    setFlowStep("analyze", { persist: true, replace: false });
  } else if (location.pathname.endsWith("/journey.html")) {
    setFlowStep("journey", { persist: true, replace: false });
  }
}
