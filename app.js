// Anvil — web IDE core
// CodeMirror 6 pulled from esm.sh at runtime (no build step, GitHub Pages friendly).
import { EditorView, basicSetup } from "https://esm.sh/codemirror@6.0.1";
import { EditorState } from "https://esm.sh/@codemirror/state@6.4.1";
import { javascript } from "https://esm.sh/@codemirror/lang-javascript@6.2.2";
import { html as htmlLang } from "https://esm.sh/@codemirror/lang-html@6.4.9";
import { css as cssLang } from "https://esm.sh/@codemirror/lang-css@6.3.1";
import { oneDark } from "https://esm.sh/@codemirror/theme-one-dark@6.1.2";
import { keymap } from "https://esm.sh/@codemirror/view@6.36.1";
import { indentWithTab, undo, redo } from "https://esm.sh/@codemirror/commands@6.7.1";

// ---------------------------------------------------------------------------
// Virtual filesystem — IndexedDB backed. Safari/iPadOS has no reliable
// File System Access API, so this (not disk access) is the source of truth.
// ---------------------------------------------------------------------------
const DB_NAME = "anvil-fs";
const STORE = "files";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "path" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

class VFS {
  constructor(db) { this.db = db; }

  static async create() {
    const db = await openDB();
    return new VFS(db);
  }

  tx(mode) {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  async list() {
    return new Promise((resolve, reject) => {
      const req = this.tx("readonly").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async read(path) {
    return new Promise((resolve, reject) => {
      const req = this.tx("readonly").get(path);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async write(path, content, kind = "file") {
    return new Promise((resolve, reject) => {
      const req = this.tx("readwrite").put({ path, content, kind, updatedAt: Date.now() });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async remove(path) {
    // Removing a folder removes everything nested under it too.
    const all = await this.list();
    const toDelete = all.filter(f => f.path === path || f.path.startsWith(path + "/"));
    const store = this.tx("readwrite");
    await Promise.all(toDelete.map(f => new Promise((res, rej) => {
      const req = store.delete(f.path);
      req.onsuccess = () => res();
      req.onerror = () => rej(req.error);
    })));
  }
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
const state = {
  vfs: null,
  files: new Map(),      // path -> {path, content, kind, updatedAt}
  openTabs: [],           // array of paths, in order
  activePath: null,
  dirty: new Set(),       // paths with unsaved editor state (debounced save, so mostly cosmetic)
  view: null,             // current CodeMirror EditorView
  splitOpen: false,
};

const DEFAULT_FILES = [
  { path: "index.html", kind: "file", content: `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>My Project</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <h1>Hello from Anvil</h1>
  <script src="script.js"><\/script>
</body>
</html>
` },
  { path: "style.css", kind: "file", content: `body {
  font-family: sans-serif;
  background: #14110f;
  color: #ede6dc;
  padding: 2rem;
}
` },
  { path: "script.js", kind: "file", content: `console.log("Anvil says hi");
` },
];

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------
function langExtensionFor(path) {
  if (path.endsWith(".html") || path.endsWith(".htm")) return htmlLang();
  if (path.endsWith(".css")) return cssLang();
  if (path.endsWith(".js") || path.endsWith(".mjs")) return javascript();
  if (path.endsWith(".json")) return javascript();
  return [];
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------
let saveTimer = null;
function scheduleSave(path, content) {
  state.dirty.add(path);
  setSaveIndicator(true);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await state.vfs.write(path, content, "file");
      const f = state.files.get(path);
      if (f) f.content = content;
      state.dirty.delete(path);
      renderTabs();
      if (state.dirty.size === 0) setSaveIndicator(false);
    } catch (err) {
      console.error("Save failed:", err);
      setSaveIndicator(false, true);
    }
  }, 400);
}

function setSaveIndicator(saving, failed = false) {
  const el = document.getElementById("saveIndicator");
  if (failed) { el.textContent = "⚠"; el.title = "Save failed — check storage space"; el.classList.remove("saved"); return; }
  el.classList.toggle("saved", !saving);
  el.textContent = saving ? "●" : "✓";
  el.title = saving ? "Saving…" : "All changes saved";
}

// ---------------------------------------------------------------------------
// File tree rendering
// ---------------------------------------------------------------------------
function buildTree(paths) {
  const root = { children: new Map() };
  for (const p of paths) {
    const parts = p.path.split("/");
    let node = root;
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      acc = acc ? acc + "/" + parts[i] : parts[i];
      const isLeaf = i === parts.length - 1;
      if (!node.children.has(parts[i])) {
        node.children.set(parts[i], {
          name: parts[i],
          path: acc,
          kind: isLeaf ? p.kind : "folder",
          children: new Map(),
        });
      }
      node = node.children.get(parts[i]);
    }
  }
  return root;
}

function renderTree() {
  const container = document.getElementById("fileTree");
  container.innerHTML = "";
  const all = Array.from(state.files.values()).sort((a, b) => a.path.localeCompare(b.path));
  const tree = buildTree(all);

  function renderNode(node, depth) {
    for (const child of Array.from(node.children.values()).sort((a, b) => {
      // folders first, then alpha
      if (a.kind === "folder" && b.kind !== "folder") return -1;
      if (b.kind === "folder" && a.kind !== "folder") return 1;
      return a.name.localeCompare(b.name);
    })) {
      const row = document.createElement("div");
      row.className = "tree-row" + (child.path === state.activePath ? " active" : "");
      row.style.setProperty("--depth", depth);
      row.setAttribute("role", "treeitem");
      row.innerHTML = `
        <span class="kind">${child.kind === "folder" ? "▸" : "·"}</span>
        <span class="name">${escapeHtml(child.name)}</span>
        <span class="del" data-del="${escapeHtml(child.path)}">✕</span>
      `;
      if (child.kind !== "folder") {
        row.addEventListener("click", (e) => {
          if (e.target.closest(".del")) return;
          openFile(child.path);
        });
      }
      row.querySelector(".del").addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete "${child.path}"?`)) return;
        await state.vfs.remove(child.path);
        await loadFiles();
        closeTab(child.path);
        renderTree();
        renderTabs();
      });
      container.appendChild(row);
      if (child.kind === "folder") renderNode(child, depth + 1);
    }
  }
  renderNode(tree, 0);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
function renderTabs() {
  const bar = document.getElementById("tabBar");
  bar.innerHTML = "";
  for (const path of state.openTabs) {
    const tab = document.createElement("div");
    tab.className = "tab" + (path === state.activePath ? " active" : "") + (state.dirty.has(path) ? " dirty" : "");
    tab.setAttribute("role", "tab");
    tab.innerHTML = `<span class="dot"></span><span class="name">${escapeHtml(path.split("/").pop())}</span><span class="close">✕</span>`;
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
    if (next) switchToTab(next);
    else { state.activePath = null; renderEditor(null); }
  }
  renderTabs();
  persistOpenTabs();
}

function persistOpenTabs() {
  try {
    localStorage.setItem("anvil-open-tabs", JSON.stringify({ open: state.openTabs, active: state.activePath }));
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------
function renderEditor(path) {
  const pane = document.getElementById("editorPane");
  pane.innerHTML = "";
  if (state.view) { state.view.destroy(); state.view = null; }

  if (!path) {
    pane.innerHTML = `<div class="empty-state">No file open.<br/>Tap “+ File” to create one.</div>`;
    return;
  }

  const file = state.files.get(path);
  if (!file) return;

  const startState = EditorState.create({
    doc: file.content,
    extensions: [
      basicSetup,
      keymap.of([indentWithTab]),
      oneDark,
      langExtensionFor(path),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const content = update.state.doc.toString();
          scheduleSave(path, content);
          if (state.splitOpen) refreshPreview();
        }
      }),
    ],
  });

  state.view = new EditorView({ state: startState, parent: pane });
}

async function openFile(path) {
  if (!state.openTabs.includes(path)) state.openTabs.push(path);
  switchToTab(path);
}

function switchToTab(path) {
  state.activePath = path;
  renderTabs();
  renderTree();
  renderEditor(path);
  persistOpenTabs();
  if (state.splitOpen) refreshPreview();
  // Collapse sidebar automatically on narrow screens after picking a file.
  if (window.innerWidth <= 720) {
    document.getElementById("sidebar").classList.add("collapsed");
  }
}

// ---------------------------------------------------------------------------
// Preview — inlines linked CSS/JS by reading them from the virtual FS,
// since there's no real server to resolve relative <link>/<script> paths.
// ---------------------------------------------------------------------------
function refreshPreview() {
  const frame = document.getElementById("previewFrame");
  const entryPath = state.files.has("index.html") ? "index.html" : state.activePath;
  const entry = entryPath ? state.files.get(entryPath) : null;
  if (!entry || entry.kind === "folder" || !entryPath.endsWith("html")) {
    frame.srcdoc = `<body style="font-family:sans-serif;color:#888;padding:2rem;">No index.html to preview yet.</body>`;
    return;
  }

  let html = entry.content;
  // Inline <link rel="stylesheet" href="...">
  html = html.replace(/<link[^>]+href=["']([^"']+)["'][^>]*>/g, (match, href) => {
    const f = state.files.get(href.replace(/^\.?\//, ""));
    if (f) return `<style>${f.content}</style>`;
    return match;
  });
  // Inline <script src="...">
  html = html.replace(/<script[^>]+src=["']([^"']+)["'][^>]*><\/script>/g, (match, src) => {
    const f = state.files.get(src.replace(/^\.?\//, ""));
    if (f) return `<script>${f.content}<\/script>`;
    return match;
  });

  frame.srcdoc = html;
}

// ---------------------------------------------------------------------------
// File / folder creation
// ---------------------------------------------------------------------------
async function createFile() {
  const name = prompt("New file path (e.g. utils/helpers.js):");
  if (!name) return;
  const path = name.trim().replace(/^\/+/, "");
  if (!path) return;
  if (state.files.has(path)) { alert("A file already exists at that path."); return; }
  await state.vfs.write(path, "", "file");
  await loadFiles();
  renderTree();
  openFile(path);
}

async function createFolder() {
  const name = prompt("New folder name (e.g. assets):");
  if (!name) return;
  const path = name.trim().replace(/^\/+|\/+$/g, "");
  if (!path) return;
  // Folders are implicit from file paths; create a placeholder so an empty
  // folder still shows up in the tree.
  const placeholder = path + "/.keep";
  if (state.files.has(placeholder)) return;
  await state.vfs.write(placeholder, "", "file");
  await loadFiles();
  renderTree();
}

// ---------------------------------------------------------------------------
// Load / boot
// ---------------------------------------------------------------------------
async function loadFiles() {
  const all = await state.vfs.list();
  state.files = new Map(all.map(f => [f.path, f]));
}

async function boot() {
  state.vfs = await VFS.create();
  await loadFiles();

  if (state.files.size === 0) {
    for (const f of DEFAULT_FILES) {
      await state.vfs.write(f.path, f.content, f.kind);
    }
    await loadFiles();
  }

  renderTree();

  let restored = null;
  try { restored = JSON.parse(localStorage.getItem("anvil-open-tabs") || "null"); } catch { /* ignore */ }
  if (restored && restored.open && restored.open.length) {
    state.openTabs = restored.open.filter(p => state.files.has(p));
    if (restored.active && state.files.has(restored.active)) {
      switchToTab(restored.active);
    } else if (state.openTabs.length) {
      switchToTab(state.openTabs[0]);
    } else {
      renderEditor(null);
    }
  } else {
    openFile("index.html");
  }

  renderTabs();
  wireChrome();
}

// ---------------------------------------------------------------------------
// Chrome: top bar, sidebar toggle, accessory bar
// ---------------------------------------------------------------------------
function wireChrome() {
  document.getElementById("newFileBtn").addEventListener("click", createFile);
  document.getElementById("newFolderBtn").addEventListener("click", createFolder);

  document.getElementById("toggleSidebar").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("collapsed");
  });

  document.getElementById("toggleSplit").addEventListener("click", () => {
    state.splitOpen = !state.splitOpen;
    document.getElementById("previewPane").classList.toggle("hidden", !state.splitOpen);
    if (state.splitOpen) refreshPreview();
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
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + offset },
      });
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

    if (btn.dataset.action === "undo") { undo(view); view.focus(); return; }
    if (btn.dataset.action === "redo") { redo(view); view.focus(); return; }
  });
}

boot().catch(err => {
  console.error("Anvil failed to start:", err);
  document.getElementById("fileTree").innerHTML =
    `<div style="padding:12px;color:#e5484d;font-size:13px;">Storage unavailable — Anvil needs IndexedDB (private/incognito mode may block it).</div>`;
});
