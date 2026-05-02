const FLOW_KEY = "rm_flow_step_v2";
const FLOW_STEPS = ["chat", "resume", "analyze", "journey"];
const FLOW_PAGE_MAP = {
  chat: "/chat.html",
  resume: "/resume.html",
  analyze: "/analyze.html",
  journey: "/journey.html",
};

function getFlowStepFromPath() {
  const path = (location.pathname || "/").toLowerCase();
  const entry = Object.entries(FLOW_PAGE_MAP).find(([, page]) => page.toLowerCase() === path);
  return entry ? entry[0] : null;
}

function getFlowStep() {
  return getFlowStepFromPath() || (FLOW_STEPS.includes(localStorage.getItem(FLOW_KEY)) ? localStorage.getItem(FLOW_KEY) : "chat");
}

function setFlowStep(step, { persist = true, replace = false } = {}) {
  const next = FLOW_STEPS.includes(step) ? step : "chat";
  if (persist) localStorage.setItem(FLOW_KEY, next);
  const target = FLOW_PAGE_MAP[next];
  if (replace) location.replace(target);
  else if (location.pathname !== target) location.href = target;
  return next;
}

function inferFlowStep() {
  const hasChat = Boolean((($("customConcern") && $("customConcern").value) || "").trim());
  if (!hasChat) return "chat";
  const hasResume = Boolean((($("resume") && $("resume").value) || "").trim());
  if (!hasResume) return "resume";
  return "analyze";
}

function updateStepNav(current) {
  document.querySelectorAll("[data-step]").forEach((btn) => btn.classList.toggle("active", btn.getAttribute("data-step") === current));
}

function ensureFlowEntry() {
  const current = getFlowStepFromPath() || inferFlowStep();
  localStorage.setItem(FLOW_KEY, current);
  updateStepNav(current);
}

function updateFlowNav() {
  ensureFlowEntry();
}

function ensureReadyForAnalysis() {
  const rememberKey = localStorage.getItem(LS.rememberKey) === "1";
  const hasApi = Boolean((rememberKey ? localStorage.getItem(LS.key) : sessionStorage.getItem(SS.key)) || "");
  if (!hasApi) {
    setStatus("请先开始聊天或填写内容。", true);
    return false;
  }
  const resumeLive = (($("resume") && $("resume").value.trim()) || "");
  const jobLive = (($("job") && $("job").value.trim()) || "");
  const resumeStored = (localStorage.getItem(DRAFT.resume) || "").trim();
  const jobStored = (localStorage.getItem(DRAFT.job) || "").trim();
  const resume = resumeLive || resumeStored;
  const job = jobLive || jobStored;
  if (resume.length < 20 || job.length < 20) {
    setStatus("请先补充需求和简历内容，再开始分析。", true);
    return false;
  }
  return true;
}

function bindFlowActions() {
  const bindClick = (id, fn) => { const el = $(id); if (el) el.addEventListener("click", fn); };
  bindClick("btnSetupOpen", () => { setFlowStep("chat"); });
  bindClick("btnSetupSave", () => { setFlowStep("chat"); });
  bindClick("btnSetupNext", () => { setFlowStep("chat"); });
  bindClick("btnSaveSettings", () => { setFlowStep("chat"); });
  bindClick("btnChatNext", () => { saveDraft(true); setFlowStep("resume"); });
  bindClick("btnChatFocusResume", () => setFlowStep("resume"));
  bindClick("btnHeroStart", () => setFlowStep("chat"));
  bindClick("btnHeroJourney", () => setFlowStep("journey"));
  bindClick("btnDemoFill", () => { fillDemoData(); setFlowStep("analyze"); });
  bindClick("btnDemoClear", () => { clearDemoData(); setFlowStep("chat"); });
  bindClick("btnDraftSave", () => { saveDraft(true); setStatus("草稿已保存。", false); });
  bindClick("btnDraftClear", () => { clearDraft(); setStatus("内容已清空。", false); setFlowStep("chat"); });
  bindClick("btnResumeAnalyze", () => { if (!ensureReadyForAnalysis()) return; saveDraft(true); setFlowStep("analyze"); });
  bindClick("btnResumeJourney", () => { saveDraft(true); setFlowStep("journey"); });
  bindClick("btnCareerPlan", async () => { if (!ensureReadyForAnalysis()) return; if (typeof runCareerPlan === "function") await runCareerPlan(); });
  bindClick("btnAnalyze", async () => { if (!ensureReadyForAnalysis()) return; if (typeof runAnalyze === "function") await runAnalyze(); });
  bindClick("btnTailor", async () => { if (!ensureReadyForAnalysis()) return; if (typeof runTailor === "function") await runTailor(); });
  bindClick("btnInterviewSim", async () => { if (!ensureReadyForAnalysis()) return; if (typeof runInterviewSim === "function") await runInterviewSim(); });
  bindClick("btnJourneyAdd", () => { addJourneyAction(); });
  bindClick("btnJourneyClear", () => { clearJourneyBoard(); });
  bindClick("btnJournalSave", () => { saveJournalEntry(); });
  bindClick("btnJournalClear", () => { clearJournal(); });
  bindClick("btnJournalReset", () => { clearJournal(); });
  bindClick("btnJourneySave", () => { saveJournalEntry(); });
  bindClick("btnMemoryEdit", () => openMemoryDialog());
  bindClick("btnMemoryReset", () => resetMemory());
  bindClick("btnEmotionOpen", () => openEmotionDialog());
}
