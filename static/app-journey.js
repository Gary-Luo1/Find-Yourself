let JOURNEY_EDIT_ID = null;

function generateJourneyId() {
  return `journey_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeJourneyItems(items) {
  const list = Array.isArray(items) ? items : [];
  let changed = false;
  const normalized = list.map((item) => {
    if (item && item.id) return item;
    changed = true;
    return { ...item, id: generateJourneyId() };
  });
  return { normalized, changed };
}

function getJourneyItems() {
  const raw = readJsonStorage(JOURNEY_KEY, []);
  const { normalized, changed } = normalizeJourneyItems(raw);
  if (changed) localStorage.setItem(JOURNEY_KEY, JSON.stringify(normalized));
  return normalized;
}

function saveJourneyItems(items) {
  const { normalized } = normalizeJourneyItems(items);
  localStorage.setItem(JOURNEY_KEY, JSON.stringify(normalized));
}

function getJourneyStatusLabel(status) {
  const map = {
    已投递: "已投递",
    筛选中: "筛选中",
    约面试: "约面试",
    面试中: "面试中",
    已通过: "已通过",
    已拒绝: "已拒绝",
    已入职: "已入职",
  };
  return map[status] || "已投递";
}

function getJourneyFilteredItems() {
  const keyword = String($("journeySearch")?.value || "").trim().toLowerCase();
  const status = String($("journeyFilterStatus")?.value || "").trim();
  const company = String($("journeyFilterCompany")?.value || "").trim().toLowerCase();
  const rows = getJourneyItems();
  return rows.filter((item) => {
    const hitKeyword = !keyword || [item.jobTitle, item.company, item.round, item.note, item.jobLink].some((v) => String(v || "").toLowerCase().includes(keyword));
    const hitStatus = !status || String(item.status || "") === status;
    const hitCompany = !company || String(item.company || "").toLowerCase().includes(company);
    return hitKeyword && hitStatus && hitCompany;
  });
}

function renderJourneyStats(rows = getJourneyItems()) {
  const total = rows.length;
  const interview = rows.filter((x) => ["约面试", "面试中"].includes(String(x.status || ""))).length;
  const offer = rows.filter((x) => String(x.status || "") === "已通过").length;
  const rejected = rows.filter((x) => String(x.status || "") === "已拒绝").length;
  const el = $("journeyStats");
  if (!el) return;
  el.innerHTML = `
    <div class="journey-stat-card"><div class="journey-stat-label">总记录</div><div class="journey-stat-value">${total}</div><div class="journey-stat-note">当前求职流水总数</div></div>
    <div class="journey-stat-card"><div class="journey-stat-label">面试中</div><div class="journey-stat-value">${interview}</div><div class="journey-stat-note">约面试 / 面试中</div></div>
    <div class="journey-stat-card"><div class="journey-stat-label">已通过</div><div class="journey-stat-value">${offer}</div><div class="journey-stat-note">已进入 offer 阶段</div></div>
    <div class="journey-stat-card"><div class="journey-stat-label">已拒绝</div><div class="journey-stat-value">${rejected}</div><div class="journey-stat-note">可用于回溯复盘</div></div>
  `;
}

function renderJourneyTable() {
  const tbody = $("journeyTableBody");
  if (!tbody) return;
  const rows = getJourneyFilteredItems();
  renderJourneyStats(getJourneyItems());
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#8a8fa3;">暂无匹配记录，请调整筛选或新增一条求职记录。</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map((item) => {
      const itemId = String(item.id || "");
      const statusClass = `journey-tag journey-tag--${String(item.status || "已投递").replace(/\s+/g, "-")}`;
      return `
      <tr>
        <td><strong>${escapeHtml(String(item.jobTitle || "—"))}</strong></td>
        <td>${escapeHtml(String(item.company || "—"))}</td>
        <td>${item.jobLink ? `<a href="${escapeHtml(String(item.jobLink))}" target="_blank" rel="noopener noreferrer">查看链接</a>` : "—"}</td>
        <td>${escapeHtml(String(item.applyDate || "—").replaceAll("-", "/"))}</td>
        <td>${escapeHtml(String(item.round || "—"))}</td>
        <td><span class="${statusClass}">${escapeHtml(getJourneyStatusLabel(item.status))}</span></td>
        <td>${escapeHtml(String(item.note || "—"))}</td>
        <td>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" class="btn btn-ghost" data-journey-edit="${escapeHtml(itemId)}">编辑</button>
            <button type="button" class="btn btn-ghost" data-journey-del="${escapeHtml(itemId)}">删除</button>
          </div>
        </td>
      </tr>
    `;
    })
    .join("");

  if (!tbody.dataset.bound) {
    tbody.dataset.bound = "1";
    tbody.addEventListener("click", (e) => {
      const editBtn = e.target.closest("[data-journey-edit]");
      const delBtn = e.target.closest("[data-journey-del]");
      if (delBtn) {
        const id = String(delBtn.getAttribute("data-journey-del") || "");
        const next = getJourneyItems();
        const idx = next.findIndex((item) => String(item.id || "") === id);
        if (idx >= 0) {
          next.splice(idx, 1);
          if (JOURNEY_EDIT_ID === id) JOURNEY_EDIT_ID = null;
          saveJourneyItems(next);
          renderJourneyTable();
          setStatus("已删除该条记录。", false);
        }
        return;
      }
      if (editBtn) {
        const id = String(editBtn.getAttribute("data-journey-edit") || "");
        const next = getJourneyItems();
        const item = next.find((entry) => String(entry.id || "") === id);
        if (!item) return;
        JOURNEY_EDIT_ID = id;
        ["journeyJobLink", "journeyJobTitle", "journeyCompany", "journeyApplyDate", "journeyRound", "journeyNote"].forEach((fieldId) => {
          const el = $(fieldId);
          if (!el) return;
          if (fieldId === "journeyJobLink") el.value = String(item.jobLink || "");
          if (fieldId === "journeyJobTitle") el.value = String(item.jobTitle || "");
          if (fieldId === "journeyCompany") el.value = String(item.company || "");
          if (fieldId === "journeyApplyDate") el.value = String(item.applyDate || "").replaceAll("/", "-");
          if (fieldId === "journeyRound") el.value = String(item.round || "");
          if (fieldId === "journeyNote") el.value = String(item.note || "");
        });
        const statusEl = $("journeyStatus");
        if (statusEl) statusEl.value = String(item.status || "已投递");
        const addBtn = $("btnJourneyAdd");
        if (addBtn) addBtn.textContent = "保存修改";
        setStatus("已进入编辑模式，修改后点击保存修改。", false);
      }
    });
  }
}

function addJourneyRecord() {
  const jobLink = String($("journeyJobLink")?.value || "").trim();
  const jobTitle = String($("journeyJobTitle")?.value || "").trim();
  const company = String($("journeyCompany")?.value || "").trim();
  const applyDateRaw = String($("journeyApplyDate")?.value || "").trim();
  const applyDate = applyDateRaw ? applyDateRaw.replaceAll("-", "/") : "";
  const round = String($("journeyRound")?.value || "").trim();
  const status = String($("journeyStatus")?.value || "").trim();
  const note = String($("journeyNote")?.value || "").trim();

  if (!jobTitle) {
    setStatus("请至少填写岗位名称。", true);
    return;
  }

  const next = getJourneyItems();
  if (JOURNEY_EDIT_ID) {
    const editIdx = next.findIndex((item) => String(item.id || "") === JOURNEY_EDIT_ID);
    if (editIdx >= 0) {
      next[editIdx] = { ...next[editIdx], jobLink, jobTitle, company, applyDate, round, status, note, updatedAt: Date.now() };
    }
    JOURNEY_EDIT_ID = null;
    saveJourneyItems(next.slice(0, 500));
    renderJourneyTable();
    ["journeyJobLink", "journeyJobTitle", "journeyCompany", "journeyApplyDate", "journeyRound", "journeyNote"].forEach((id) => {
      const el = $(id);
      if (el) el.value = "";
    });
    const statusEl = $("journeyStatus");
    if (statusEl) statusEl.value = "已投递";
    const addBtn = $("btnJourneyAdd");
    if (addBtn) addBtn.textContent = "新增记录";
    setStatus("已保存修改。", false);
    return;
  }

  next.unshift({ id: `journey_${Date.now()}_${Math.random().toString(16).slice(2)}`, jobLink, jobTitle, company, applyDate, round, status, note, createdAt: Date.now() });
  saveJourneyItems(next.slice(0, 500));

  ["journeyJobLink", "journeyJobTitle", "journeyCompany", "journeyApplyDate", "journeyRound", "journeyNote"].forEach((id) => {
    const el = $(id);
    if (el) el.value = "";
  });
  const statusEl = $("journeyStatus");
  if (statusEl) statusEl.value = "已投递";

  renderJourneyTable();
  setStatus("求职记录已新增。", false);
}

function clearJourneyRecords() {
  saveJourneyItems([]);
  renderJourneyTable();
  setStatus("已清空所有求职记录。", false);
}

function clearJourneyFilters() {
  const search = $("journeySearch");
  const status = $("journeyFilterStatus");
  const company = $("journeyFilterCompany");
  if (search) search.value = "";
  if (status) status.value = "";
  if (company) company.value = "";
  renderJourneyTable();
  setStatus("已清空筛选条件。", false);
}

function exportJourneyCsv() {
  const rows = getJourneyItems();
  const header = ["岗位名称", "公司名称", "岗位链接", "投递时间", "面试轮次", "当前状态", "备注", "创建时间"];
  const csvRows = [header.join(",")];
  rows.forEach((item) => {
    const line = [item.jobTitle, item.company, item.jobLink, item.applyDate, item.round, item.status, item.note, item.createdAt]
      .map((v) => `"${String(v || "").replaceAll('"', '""')}"`)
      .join(",");
    csvRows.push(line);
  });
  const blob = new Blob(["\ufeff" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `求职旅程记录_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setStatus("已导出表格。", false);
}

function renderJourneyBoard() {
  renderJourneyTable();
}

function renderJourneyStage() {}
function renderWeeklyReview() {}
function renderJournalList() {}
function addJourneyAction() { addJourneyRecord(); }
function clearJourneyBoard() { clearJourneyRecords(); }
function saveJournalEntry() {}
function clearJournal() {}
function resetJourney() {}
