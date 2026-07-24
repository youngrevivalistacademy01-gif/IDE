// tree.js — renders the file explorer. Owns its own UI state (which
// folders are expanded, what's mid-rename, which row's menu is open) and
// talks to the VFS directly for mutations, then reports back up via
// callbacks so app.js can keep tabs/editor in sync.

import { iconFor } from "./icons.js";

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function leafName(path) {
  return path.split("/").pop();
}

export class FileTree {
  /**
   * @param {HTMLElement} container
   * @param {import("./vfs.js").VFS} vfs
   * @param {{
   *   getFiles: () => Map<string, object>,
   *   getActivePath: () => string|null,
   *   onOpenFile: (path: string) => void,
   *   onGoLive: (path: string) => void,
   *   onStructureChanged: (opts: {renamed?: [string,string], deleted?: string}) => void,
   * }} hooks
   */
  constructor(container, vfs, hooks) {
    this.container = container;
    this.vfs = vfs;
    this.hooks = hooks;
    this.expanded = new Set();
    this.creating = null;   // { parentPath: string|null, kind: 'file'|'folder' }
    this.renaming = null;   // path currently being renamed
    this.openMenuPath = null;

    document.addEventListener("click", (e) => {
      if (this.openMenuPath && !e.target.closest(".tree-menu") && !e.target.closest(".menu-btn")) {
        this.openMenuPath = null;
        this.render();
      }
    });
  }

  beginCreate(parentPath, kind) {
    if (parentPath) this.expanded.add(parentPath);
    this.creating = { parentPath, kind };
    this.openMenuPath = null;
    this.render();
  }

  beginRename(path) {
    this.renaming = path;
    this.openMenuPath = null;
    this.render();
  }

  async commitCreate(name) {
    const trimmed = name.trim().replace(/\//g, "");
    const { parentPath, kind } = this.creating;
    this.creating = null;
    if (!trimmed) { this.render(); return; }

    const path = parentPath ? `${parentPath}/${trimmed}` : trimmed;
    if (await this.vfs.exists(path)) {
      alert(`"${trimmed}" already exists here.`);
      this.render();
      return;
    }
    if (kind === "folder") await this.vfs.createFolder(path);
    else await this.vfs.writeFile(path, "");
    this.hooks.onStructureChanged({});
  }

  async commitRename(oldPath, name) {
    const trimmed = name.trim().replace(/\//g, "");
    this.renaming = null;
    if (!trimmed || trimmed === leafName(oldPath)) { this.render(); return; }

    const dir = oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/") + 1) : "";
    const newPath = dir + trimmed;
    try {
      await this.vfs.rename(oldPath, newPath);
      this.hooks.onStructureChanged({ renamed: [oldPath, newPath] });
    } catch (err) {
      alert(err.message);
      this.render();
    }
  }

  async deleteEntry(path, kind) {
    const label = kind === "folder" ? "folder and everything in it" : "file";
    if (!confirm(`Delete this ${label}?\n${path}`)) return;
    await this.vfs.remove(path);
    this.hooks.onStructureChanged({ deleted: path });
  }

  toggleFolder(path) {
    if (this.expanded.has(path)) this.expanded.delete(path);
    else this.expanded.add(path);
    this.render();
  }

  toggleMenu(path) {
    this.openMenuPath = this.openMenuPath === path ? null : path;
    this.render();
  }

  // Builds a nested tree from flat {path, kind} entries.
  buildNodes(entries) {
    const root = { children: new Map() };
    for (const e of entries) {
      const parts = e.path.split("/");
      let node = root;
      let acc = "";
      for (let i = 0; i < parts.length; i++) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        const isLeaf = i === parts.length - 1;
        if (!node.children.has(parts[i])) {
          node.children.set(parts[i], {
            name: parts[i],
            path: acc,
            kind: isLeaf ? e.kind : "folder",
            children: new Map(),
          });
        }
        node = node.children.get(parts[i]);
      }
    }
    return root;
  }

  render() {
    const files = this.hooks.getFiles();
    const activePath = this.hooks.getActivePath();
    const entries = Array.from(files.values());
    const tree = this.buildNodes(entries);

    this.container.innerHTML = "";
    this.renderCreateInput(this.container, null, 0); // root-level create input, if active
    this.renderChildren(tree, 0, this.container, activePath);

    if (entries.length === 0 && !this.creating) {
      const empty = document.createElement("div");
      empty.className = "tree-empty";
      empty.innerHTML = `Nothing here yet.<br/>Use <strong>New File</strong> above to start.`;
      this.container.appendChild(empty);
    }
  }

  renderCreateInput(container, parentPath, depth) {
    if (!this.creating || this.creating.parentPath !== parentPath) return;
    const row = document.createElement("div");
    row.className = "tree-row creating";
    row.style.setProperty("--depth", depth);
    const icon = iconFor(
      this.creating.kind === "folder" ? "x" : "x.txt",
      this.creating.kind,
      false
    );
    row.innerHTML = `<span class="row-icon">${icon}</span>`;
    const input = document.createElement("input");
    input.className = "inline-input";
    input.placeholder = this.creating.kind === "folder" ? "folder name" : "file name.ext";
    row.appendChild(input);
    container.appendChild(row);

    requestAnimationFrame(() => input.focus());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.commitCreate(input.value);
      if (e.key === "Escape") { this.creating = null; this.render(); }
    });
    input.addEventListener("blur", () => this.commitCreate(input.value));
  }

  renderChildren(node, depth, container, activePath) {
    const sorted = Array.from(node.children.values()).sort((a, b) => {
      if (a.kind === "folder" && b.kind !== "folder") return -1;
      if (b.kind === "folder" && a.kind !== "folder") return 1;
      return a.name.localeCompare(b.name);
    });

    for (const child of sorted) {
      const isFolder = child.kind === "folder";
      const isExpanded = this.expanded.has(child.path);
      const isRenaming = this.renaming === child.path;
      const isMenuOpen = this.openMenuPath === child.path;

      const row = document.createElement("div");
      row.className = "tree-row" + (child.path === activePath ? " active" : "");
      row.style.setProperty("--depth", depth);

      if (isRenaming) {
        row.innerHTML = `<span class="row-icon">${iconFor(child.name, child.kind, isExpanded)}</span>`;
        const input = document.createElement("input");
        input.className = "inline-input";
        input.value = child.name;
        row.appendChild(input);
        container.appendChild(row);
        requestAnimationFrame(() => { input.focus(); input.select(); });
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") this.commitRename(child.path, input.value);
          if (e.key === "Escape") { this.renaming = null; this.render(); }
        });
        input.addEventListener("blur", () => this.commitRename(child.path, input.value));
      } else {
        row.innerHTML = `
          <span class="row-icon">${iconFor(child.name, child.kind, isExpanded)}</span>
          <span class="row-name">${escapeHtml(child.name)}</span>
          <button class="menu-btn" title="Actions" aria-label="Actions for ${escapeHtml(child.name)}">⋮</button>
        `;
        row.querySelector(".row-name").addEventListener("click", () => {
          if (isFolder) this.toggleFolder(child.path);
          else this.hooks.onOpenFile(child.path);
        });
        row.querySelector(".menu-btn").addEventListener("click", (e) => {
          e.stopPropagation();
          this.toggleMenu(child.path);
        });
        container.appendChild(row);

        if (isMenuOpen) {
          container.appendChild(this.renderMenu(child, depth));
        }
      }

      if (isFolder && isExpanded) {
        this.renderCreateInput(container, child.path, depth + 1);
        this.renderChildren(child, depth + 1, container, activePath);
      }
    }
  }

  renderMenu(child, depth) {
    const menu = document.createElement("div");
    menu.className = "tree-menu";
    menu.style.setProperty("--depth", depth);

    const items = [];
    if (child.kind === "folder") {
      items.push(["Add file", () => this.beginCreate(child.path, "file")]);
      items.push(["Rename folder", () => this.beginRename(child.path)]);
      items.push(["Delete folder", () => this.deleteEntry(child.path, "folder")]);
    } else {
      items.push(["Rename file", () => this.beginRename(child.path)]);
      if (/\.html?$/.test(child.name)) {
        items.push(["Go live", () => { this.openMenuPath = null; this.hooks.onGoLive(child.path); this.render(); }]);
      }
      items.push(["Delete file", () => this.deleteEntry(child.path, "file")]);
    }

    for (const [label, fn] of items) {
      const btn = document.createElement("button");
      btn.className = "tree-menu-item" + (label.startsWith("Delete") ? " danger" : "");
      btn.textContent = label;
      btn.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
      menu.appendChild(btn);
    }
    return menu;
  }
}
