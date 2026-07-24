// icons.js — small inline SVGs, color-coded by file type so the tree is
// scannable at a glance instead of everything looking like a plain page.

const svg = (paths, color) =>
  `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" xmlns="http://www.w3.org/2000/svg" style="color:${color}">${paths}</svg>`;

const ICONS = {
  folderClosed: svg(
    `<path d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3.6l1.2 1.4H13.5A1 1 0 0 1 14.5 5v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-9Z" fill="currentColor"/>`,
    "var(--ember)"
  ),
  folderOpen: svg(
    `<path d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3.6l1.2 1.4H13.5A1 1 0 0 1 14.5 5v.6H3.9a1 1 0 0 0-.95.68L1.5 10.6V3.5Z" fill="currentColor" opacity="0.55"/><path d="M1.65 11.2 3 6.9a1 1 0 0 1 .95-.7h9.6a1 1 0 0 1 .96 1.28l-1.36 4.3a1 1 0 0 1-.95.72H2.6a1 1 0 0 1-.95-1.3Z" fill="currentColor"/>`,
    "var(--ember)"
  ),
  html: svg(
    `<path d="M2 1.5h12L13 12l-5 1.7-5-1.7L2 1.5Z" fill="currentColor" opacity="0.18"/><path d="M4.6 4h6.8l-.2 1.6H6.4l.15 1.5h4.5l-.4 4L8 12l-2.6-.8-.15-1.7h1.5l.08.8L8 10.7l1.2-.4.15-1.6H4.9L4.6 4Z" fill="currentColor"/>`,
    "#ff6b35"
  ),
  css: svg(
    `<path d="M2 1.5h12L13 12l-5 1.7-5-1.7L2 1.5Z" fill="currentColor" opacity="0.18"/><path d="M4.6 4h6.8l-.2 1.6H6.35l.1 1.2h4.55l-.35 3.7L8 11.4l-2.65-.8-.1-1.2h1.5l.06.6L8 10.3l1.15-.35.15-1.55H5.75L5.3 4.85 4.6 4Z" fill="currentColor"/>`,
    "#4fd1c5"
  ),
  js: svg(
    `<rect x="2" y="2" width="12" height="12" rx="1.5" fill="currentColor" opacity="0.18"/><path d="M8.4 4.5h1.3v5.3c0 1.4-.7 2.1-1.9 2.1-.5 0-1-.1-1.3-.3l.25-1.1c.2.1.5.2.8.2.5 0 .85-.25.85-1.1V4.5Zm3.9 5.9c.35.25.85.45 1.4.45.6 0 .9-.25.9-.6 0-.35-.25-.55-.9-.8-1.05-.4-1.7-.9-1.7-1.85 0-1.05.85-1.75 2.05-1.75.65 0 1.1.15 1.4.3l-.25 1.05c-.2-.1-.6-.3-1.15-.3-.55 0-.8.25-.8.55 0 .35.3.5 1 .8 1.1.4 1.6.95 1.6 1.9 0 1.05-.8 1.85-2.2 1.85-.65 0-1.3-.2-1.6-.4l.25-1.2Z" fill="currentColor"/>`,
    "#ecc94b"
  ),
  json: svg(
    `<path d="M5.2 2c-1 0-1.5.5-1.5 1.5v1.3c0 .8-.3 1.1-.9 1.1v1.2c.6 0 .9.3.9 1.1v1.3c0 1 .5 1.5 1.5 1.5" stroke="currentColor" stroke-width="1.1" fill="none"/><path d="M10.8 2c1 0 1.5.5 1.5 1.5v1.3c0 .8.3 1.1.9 1.1v1.2c-.6 0-.9.3-.9 1.1v1.3c0 1-.5 1.5-1.5 1.5" stroke="currentColor" stroke-width="1.1" fill="none"/>`,
    "#a0a0a0"
  ),
  md: svg(
    `<rect x="1.5" y="3" width="13" height="10" rx="1" fill="currentColor" opacity="0.18"/><path d="M3.5 10.5v-5l2 2.4 2-2.4v5" stroke="currentColor" stroke-width="1.1" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.5 5.5v3.2M9.2 7.4l1.3 1.4 1.3-1.4" stroke="currentColor" stroke-width="1.1" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    "#8a8175"
  ),
  generic: svg(
    `<path d="M4 1.5h5.5L12 4v10.5H4Z" fill="currentColor" opacity="0.18" stroke="currentColor" stroke-width="0.8"/><path d="M9.3 1.5V4H12" stroke="currentColor" stroke-width="0.8" fill="none"/>`,
    "#8a8175"
  ),
};

const EXT_MAP = {
  html: "html", htm: "html",
  css: "css",
  js: "js", mjs: "js", jsx: "js", ts: "js", tsx: "js",
  json: "json",
  md: "md", markdown: "md",
};

export function iconFor(name, kind, expanded) {
  if (kind === "folder") return expanded ? ICONS.folderOpen : ICONS.folderClosed;
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  return ICONS[EXT_MAP[ext]] || ICONS.generic;
}
