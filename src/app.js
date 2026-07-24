import { VFS } from "./vfs.js";
import { FileTree } from "./tree.js";
import { createEditorView, undo, redo } from "./editor.js";
import { buildPreviewDoc, enterFullscreen, exitFullscreen, isFullscreen } from "./preview.js";

const state = {
  vfs: null,
  files: new Map(),        // path -> {path, kind, content, updatedAt}
  openTabs: [],
  activePath: null,
  dirty: new Set(),
  view: null,
  tree: null,
  theme: localStorage.getItem("anvil-theme") || "dark",
  splitOpen: false,
  previewEntry: null,       // which HTML file "Go live" points at
};

// ---------------------------------------------------------------------------
// Persistence (debounced editor autosave)
// ---------------------------------------------------------------------------
let saveTimer = null;
function scheduleSave(path, content) {
  state.dirty.add(path);
  setSaveIndicator("saving");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await state.vfs.writeFile(path, content);
      const f = state.files.get(path);
      if (f) f.content = content;
      state.dirty.delete(path);
      renderTabs();
      if (state.dirty.size === 0) setSaveIndicator("saved");
    } catch (err) {
      console.error("Save failed:", err);
      setSaveIndicator("error");
    }
  }, 400);
}

function setSaveIndicator(status) {
  const el = document.getElementById("saveIndicator");
  if (status === "error") { el.textContent = "⚠"; el.title = "Save failed — check available storage"; return; }
  el.textContent = status === "saving" ? "●" : "✓";
  el.title = status === "saving" ? "Saving…" : "All changes saved";
  el.classList.toggle("saved", status !== "saving");
}

// ---------------------------------------------------------------------------
// Load files from the VFS into memory
// ---------------------------------------------------------------------------
async function loadFiles() {
  const all = await state.vfs.list();
  state.files = new Map(all.map(f => [f.path, f]));
}

async function refreshTreeAndTabs({ renamed, deleted } = {}) {
  await loadFiles();

  if (renamed) {
    const [oldPath, newPath] = renamed;
    state.openTabs = state.openTabs.map(p =>
      p === oldPath || p.startsWith(oldPath + "/") ? newPath + p.slice(oldPath.length) : p
    );
    if (state.activePath === oldPath || state.activePath?.startsWith(oldPath + "/")) {
      state.activePath = newPath + state.activePath.slice(oldPath.length);
    }
    if (state.previewEntry === oldPath) state.previewEntry = newPath;
  }

  if (deleted) {
    state.openTabs = state.openTabs.filter(p => p !== deleted && !p.startsWith(deleted + "/"));
    if (state.activePath === deleted || state.activePath?.startsWith(deleted + "/")) {
      state.activePath = state.openTabs[0] || null;
    }
    if (state.previewEntry === deleted) state.previewEntry = null;
  }

  state.tree.render();
  renderTabs();
  renderEditor(state.activePath);
  persistOpenTabs();
  if (state.splitOpen) refreshPreview();
}

function persistOpenTabs() {
  try {
    localStorage.setItem("anvil-open-tabs", JSON.stringify({ open: state.openTabs, active: state.activePath }));
  } catch { /* non-fatal: just won't restore tabs next load */ }
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
function renderTabs() {
  const bar = document.getElementById("tabBar");
  bar.innerHTML = "";
  for (const path of state.openTabs) {
    if (!state.files.has(path)) continue;
    const tab = document.createElement("div");
    tab.className = "tab" + (path === state.activePath ? " active" : "") + (state.dirty.has(path) ? " dirty" : "");
    tab.setAttribute("role", "tab");
    tab.innerHTML = `<span class="dot"></span><span class="name">${path.split("/").pop()}</span><span class="close">✕</span>`;
    tab.addEventListener("click", (e) => {
      if (e.target.closest(".close")) { closeTab(path); return; }
      switchToTab(path);
    });
    bar.appendChild(tab);
  }
}

function closeTab(path) {
  const idx = state.openTabs.indexOf(path);
  if (idx === -1) return;
  state.openTabs.splice(idx, 1);
  if (state.activePath === path) {
    const next = state.openTabs[idx] || state.openTabs[idx - 1] || null;
    state.activePath = next;
  }
  renderTabs();
  renderEditor(state.activePath);
  state.tree.render();
  persistOpenTabs();
}

function switchToTab(path) {
  state.activePath = path;
  renderTabs();
  renderEditor(path);
  state.tree.render();
  persistOpenTabs();
  if (window.innerWidth <= 720) document.getElementById("sidebar").classList.add("collapsed");
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------
function renderEditor(path) {
  const pane = document.getElementById("editorPane");
  pane.innerHTML = "";
  if (state.view) { state.view.destroy(); state.view = null; }

  if (!path || !state.files.has(path)) {
    pane.innerHTML = `<div class="empty-state">No file open.<br/>Create one from the sidebar.</div>`;
    return;
  }

  const file = state.files.get(path);
  state.view = createEditorView({
    parent: pane,
    path,
    content: file.content,
    isDark: state.theme === "dark",
    onChange: (content) => {
      scheduleSave(path, content);
      if (state.splitOpen && path === state.previewEntry) refreshPreview();
    },
  });
}

function openFile(path) {
  if (!state.openTabs.includes(path)) state.openTabs.push(path);
  switchToTab(path);
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------
function refreshPreview() {
  const frame = document.getElementById("previewFrame");
  const entry = state.previewEntry && state.files.has(state.previewEntry)
    ? state.previewEntry
    : (state.files.has("index.html") ? "index.html" : null);
  frame.srcdoc = entry
    ? buildPreviewDoc(entry, state.files)
    : `<body style="font-family:sans-serif;color:#888;padding:2rem;">Use “Go live” on an HTML file to preview it here.</body>`;
}

function openPreviewFor(path) {
  state.previewEntry = path;
  state.splitOpen = true;
  document.getElementById("previewPane").classList.remove("hidden");
  refreshPreview();
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
  const btn = document.getElementById("toggleTheme");
  if (btn) btn.textContent = state.theme === "dark" ? "☾" : "☀";
  // Editor needs to be rebuilt since the theme is a set of CM extensions.
  if (state.activePath) renderEditor(state.activePath);
}

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  localStorage.setItem("anvil-theme", state.theme);
  applyTheme();
}

// ---------------------------------------------------------------------------
// Chrome wiring
// ---------------------------------------------------------------------------
function wireChrome() {
  document.getElementById("newFileBtn").addEventListener("click", () => state.tree.beginCreate(null, "file"));
  document.getElementById("newFolderBtn").addEventListener("click", () => state.tree.beginCreate(null, "folder"));

  document.getElementById("toggleSidebar").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("collapsed");
  });

  document.getElementById("toggleSplit").addEventListener("click", () => {
    state.splitOpen = !state.splitOpen;
    document.getElementById("previewPane").classList.toggle("hidden", !state.splitOpen);
    if (state.splitOpen) refreshPreview();
  });

  document.getElementById("toggleTheme").addEventListener("click", toggleTheme);

  const fsBtn = document.getElementById("fullscreenPreview");
  fsBtn.addEventListener("click", () => {
    const pane = document.getElementById("previewPane");
    if (isFullscreen()) exitFullscreen();
    else enterFullscreen(pane);
  });
  document.addEventListener("fullscreenchange", () => {
    fsBtn.textContent = isFullscreen() ? "⤡" : "⛶";
    document.getElementById("previewPane").classList.toggle("is-fullscreen", isFullscreen());
  });

  const accessory = document.getElementById("accessoryBar");
  accessory.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || !state.view) return;
    const view = state.view;

    if (btn.dataset.insert !== undefined) {
      const text = btn.dataset.insert === "\\t" ? "\t" : btn.dataset.insert;
      const offset = btn.dataset.cursorOffset ? parseInt(btn.dataset.cursorOffset, 10) : text.length;
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + offset } });
      view.focus();
      return;
    }

    if (btn.dataset.move) {
      const { from } = view.state.selection.main;
      const line = view.state.doc.lineAt(from);
      let target = from;
      if (btn.dataset.move === "left") target = Math.max(0, from - 1);
      if (btn.dataset.move === "right") target = Math.min(view.state.doc.length, from + 1);
      if (btn.dataset.move === "up" && line.number > 1) {
        const prevLine = view.state.doc.line(line.number - 1);
        target = Math.min(prevLine.to, prevLine.from + (from - line.from));
      }
      if (btn.dataset.move === "down" && line.number < view.state.doc.lines) {
        const nextLine = view.state.doc.line(line.number + 1);
        target = Math.min(nextLine.to, nextLine.from + (from - line.from));
      }
      view.dispatch({ selection: { anchor: target } });
      view.focus();
      return;
    }

    if (btn.dataset.action === "undo") { undo(view); view.focus(); }
    if (btn.dataset.action === "redo") { redo(view); view.focus(); }
  });
}

// ---------------------------------------------------------------------------
// Boot — deliberately does NOT seed any starter files. Empty project stays
// empty until the person creates something.
// ---------------------------------------------------------------------------
async function boot() {
  state.vfs = await VFS.create();
  await loadFiles();
  applyTheme();

  state.tree = new FileTree(document.getElementById("fileTree"), state.vfs, {
    getFiles: () => state.files,
    getActivePath: () => state.activePath,
    onOpenFile: openFile,
    onGoLive: openPreviewFor,
    onStructureChanged: refreshTreeAndTabs,
  });
  state.tree.render();

  let restored = null;
  try { restored = JSON.parse(localStorage.getItem("anvil-open-tabs") || "null"); } catch { /* ignore */ }
  if (restored?.open?.length) {
    state.openTabs = restored.open.filter(p => state.files.has(p));
    state.activePath = restored.active && state.files.has(restored.active) ? restored.active : state.openTabs[0] || null;
  }

  renderTabs();
  renderEditor(state.activePath);
  wireChrome();
}

boot().catch(err => {
  console.error("Anvil failed to start:", err);
  document.getElementById("fileTree").innerHTML =
    `<div class="tree-error">Storage unavailable — Anvil needs IndexedDB (private/incognito mode may block it).</div>`;
});
