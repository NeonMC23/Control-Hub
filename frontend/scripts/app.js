async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return await res.json();
}

const state = {
  apps: {},
  status: {},
  filter: "",
  launching: new Set(),
  logs: { appId: null, timer: null },
};

function $(sel) {
  return document.querySelector(sel);
}

function el(tag, className) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
}

function sanitizeId(id) {
  return encodeURIComponent(String(id || ""));
}

async function refreshApps() {
  state.apps = await api("/api/apps");
}

async function refreshStatus() {
  state.status = await api("/api/apps/status");
}

function statusDot(appId) {
  const st = state.status[appId] || {};
  const dot = el("div", "status-dot");
  if (state.launching.has(appId)) {
    dot.style.background = "rgba(255, 200, 70, 0.95)";
    dot.style.boxShadow = "0 0 0 3px rgba(255, 200, 70, 0.18)";
    return dot;
  }
  if (st.running) dot.classList.add("ok");
  return dot;
}

function renderApps() {
  const grid = $("#appsGrid");
  grid.innerHTML = "";

  const allIds = Object.keys(state.apps);
  const ids = allIds
    .filter((id) => {
      if (!state.filter) return true;
      const cfg = state.apps[id] || {};
      const q = state.filter.toLowerCase();
      return String(id).toLowerCase().includes(q) || String(cfg.name || "").toLowerCase().includes(q);
    })
    .sort((a, b) => a.localeCompare(b));

  if (!ids.length) {
    const empty = el("div", "panel glass");
    empty.textContent = allIds.length ? "Aucun résultat." : "Aucune application. Clique sur “Ajouter”.";
    grid.appendChild(empty);
    return;
  }

  for (const appId of ids) {
    const cfg = state.apps[appId];
    const st = state.status[appId] || {};
    const port = st.running ? st.port : st.desired_port;

    const card = el("div", "card glass");

    const title = el("div", "card-title");
    const h2 = el("h2");
    h2.textContent = cfg.name || appId;
    title.appendChild(h2);
    title.appendChild(statusDot(appId));

    const meta = el("div", "muted");
    meta.textContent = `Port: ${port ?? "—"} · PID: ${st.pid || "—"}`;

    const linkRow = el("div");
    if (port) {
      const a = el("a", "link");
      a.href = `http://localhost:${port}`;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.textContent = `http://localhost:${port}`;
      linkRow.appendChild(a);
    } else {
      linkRow.textContent = "Port: (défini dans port.json)";
    }

    const actions = el("div", "actions");
    const btnLaunch = el("button", "btn btn-primary");
    btnLaunch.textContent = st.running ? "Relancer" : "Lancer";
    btnLaunch.addEventListener("click", async () => {
      state.launching.add(appId);
      renderApps();
      try {
        await api(`/api/apps/${sanitizeId(appId)}/launch`, { method: "POST" });
      } finally {
        state.launching.delete(appId);
      }
      await refreshStatus();
      renderApps();
    });

    const btnStop = el("button", "btn");
    btnStop.textContent = "Arrêter";
    btnStop.addEventListener("click", async () => {
      await api(`/api/apps/${sanitizeId(appId)}/stop`, { method: "POST" });
      await refreshStatus();
      renderApps();
    });

    const btnLogs = el("button", "btn");
    btnLogs.textContent = "Voir les logs";
    btnLogs.addEventListener("click", async () => openLogs(appId, cfg.name || appId));

    actions.appendChild(btnLaunch);
    actions.appendChild(btnStop);
    actions.appendChild(btnLogs);

    const portRow = el("div", "row");
    const portLabel = el("div", "muted");
    portLabel.textContent = "Port:";
    const portInput = el("input", "input");
    portInput.type = "number";
    portInput.style.maxWidth = "160px";
    portInput.value = String(st.desired_port ?? port ?? 5000);
    const btnSavePort = el("button", "btn");
    btnSavePort.textContent = "Enregistrer";
    btnSavePort.addEventListener("click", async () => {
      const v = parseInt(portInput.value, 10);
      if (!Number.isFinite(v)) return;
      await api(`/api/apps/${sanitizeId(appId)}/port`, { method: "PUT", body: JSON.stringify({ port: v }) });
      await refreshStatus();
      renderApps();
    });
    portRow.appendChild(portLabel);
    portRow.appendChild(portInput);
    portRow.appendChild(btnSavePort);

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(linkRow);
    card.appendChild(actions);
    card.appendChild(portRow);
    grid.appendChild(card);
  }
}

async function refreshHealth() {
  try {
    await api("/api/health");
    $("#serverStatus").textContent = "Backend: OK";
  } catch {
    $("#serverStatus").textContent = "Backend: OFF";
  }
}

function openModal(modalEl) {
  modalEl.classList.remove("hidden");
}

function closeModal(modalEl) {
  modalEl.classList.add("hidden");
}

function setupModals() {
  document.querySelectorAll(".modal").forEach((m) => {
    m.addEventListener("click", (e) => {
      const t = e.target;
      if (t && t.dataset && t.dataset.close) closeModal(m);
    });
  });
}

function dirname(p) {
  const s = String(p || "").replaceAll("\\", "/");
  const i = s.lastIndexOf("/");
  if (i <= 0) return s;
  return s.slice(0, i);
}

async function browseScript() {
  const r = await api("/api/dialog/select_script", { method: "POST" });
  $("#add_script_path").value = r.path;
  if (!$("#add_project_root").value.trim()) $("#add_project_root").value = dirname(r.path);
}

async function browseRoot() {
  const r = await api("/api/dialog/select_folder", { method: "POST" });
  $("#add_project_root").value = r.path;
}

function setupAddApp() {
  const modal = $("#addAppModal");
  $("#btnAddApp").addEventListener("click", () => openModal(modal));
  $("#btnBrowseScript").addEventListener("click", () => browseScript().catch(showAddError));
  $("#btnBrowseRoot").addEventListener("click", () => browseRoot().catch(showAddError));

  function showAddError(e) {
    const msg = String(e?.message || e);
    $("#addAppError").textContent = msg;
    $("#addAppError").classList.remove("hidden");
  }

  $("#btnSaveApp").addEventListener("click", async () => {
    $("#addAppError").classList.add("hidden");
    try {
      const payload = {
        id: $("#add_id").value.trim(),
        name: $("#add_name").value.trim(),
        script_path: $("#add_script_path").value.trim(),
        project_root: $("#add_project_root").value.trim(),
        port_file: $("#add_port_file").value.trim() || "port.json",
        auto_launch: $("#add_autolaunch").value === "1",
      };
      await api("/api/apps", { method: "POST", body: JSON.stringify(payload) });
      closeModal(modal);
      await refreshApps();
      await refreshStatus();
      renderApps();
    } catch (e) {
      showAddError(e);
    }
  });
}

async function openLogs(appId, title) {
  const modal = $("#logsModal");
  $("#logsTitle").textContent = `Logs · ${title}`;
  openModal(modal);

  state.logs.appId = appId;
  if (state.logs.timer) clearInterval(state.logs.timer);

  const tick = async () => {
    if (!state.logs.appId) return;
    const r = await api(`/api/apps/${sanitizeId(appId)}/logs?tail=600`);
    const lines = r.lines || [];
    $("#logsTitle").textContent = `Logs · ${title} · ${r.log_path || ""}`;
    const consoleEl = $("#logsConsole");
    consoleEl.textContent = lines.join("\n") || "Aucun log pour le moment.";
    consoleEl.scrollTop = consoleEl.scrollHeight;
  };

  await tick().catch(() => {});
  state.logs.timer = setInterval(() => tick().catch(() => {}), 2000);
}

function setupLogsModalClose() {
  const modal = $("#logsModal");
  modal.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.dataset && t.dataset.close) {
      state.logs.appId = null;
      if (state.logs.timer) clearInterval(state.logs.timer);
      state.logs.timer = null;
    }
  });
}

function setupSearch() {
  $("#searchInput").addEventListener("input", (e) => {
    state.filter = e.target.value.trim();
    renderApps();
  });
}

async function tick() {
  await refreshHealth();
  await refreshStatus();
  renderApps();
}

async function main() {
  setupModals();
  setupAddApp();
  setupLogsModalClose();
  setupSearch();

  await refreshApps();
  await refreshStatus();
  renderApps();

  setInterval(() => tick().catch(() => {}), 5000);
  tick().catch(() => {});
}

main().catch(() => {});
