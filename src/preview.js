// preview.js — renders an HTML file in a sandboxed iframe. Since there's no
// real server, relative <link>/<script> tags are resolved by reading the
// referenced file straight out of the virtual filesystem and inlining it.

function resolveRelative(entryPath, href) {
  if (/^https?:\/\//.test(href)) return null; // leave real external URLs alone
  const clean = href.replace(/^\.?\//, "");
  const entryDir = entryPath.includes("/") ? entryPath.slice(0, entryPath.lastIndexOf("/") + 1) : "";
  return entryDir + clean;
}

export function buildPreviewDoc(entryPath, filesByPath) {
  const entry = filesByPath.get(entryPath);
  if (!entry || entry.kind !== "file") {
    return `<body style="font-family:sans-serif;color:#888;padding:2rem;">No HTML file selected for preview.</body>`;
  }

  let html = entry.content;

  html = html.replace(/<link[^>]+href=["']([^"']+)["'][^>]*>/g, (match, href) => {
    const resolved = resolveRelative(entryPath, href);
    const f = resolved && filesByPath.get(resolved);
    return f ? `<style>${f.content}</style>` : match;
  });

  html = html.replace(/<script[^>]+src=["']([^"']+)["'][^>]*><\/script>/g, (match, src) => {
    const resolved = resolveRelative(entryPath, src);
    const f = resolved && filesByPath.get(resolved);
    return f ? `<script>${f.content}<\/script>` : match;
  });

  return html;
}

export function enterFullscreen(el) {
  if (el.requestFullscreen) return el.requestFullscreen();
  if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen(); // iPadOS Safari
}

export function exitFullscreen() {
  if (document.exitFullscreen) return document.exitFullscreen();
  if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
}

export function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}
