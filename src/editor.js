// editor.js — wraps CodeMirror 6. Pulled from esm.sh at runtime (no build
// step, so this works dropped straight into GitHub Pages).
import { EditorView, basicSetup } from "https://esm.sh/codemirror@6.0.1";
import { EditorState } from "https://esm.sh/@codemirror/state@6.4.1";
import { javascript } from "https://esm.sh/@codemirror/lang-javascript@6.2.2";
import { html as htmlLang } from "https://esm.sh/@codemirror/lang-html@6.4.9";
import { css as cssLang } from "https://esm.sh/@codemirror/lang-css@6.3.1";
import { oneDark } from "https://esm.sh/@codemirror/theme-one-dark@6.1.2";
import { keymap } from "https://esm.sh/@codemirror/view@6.36.1";
import { indentWithTab, undo, redo } from "https://esm.sh/@codemirror/commands@6.7.1";

export { undo, redo };

function langExtensionFor(path) {
  if (/\.(html|htm)$/.test(path)) return htmlLang();
  if (/\.css$/.test(path)) return cssLang();
  if (/\.(js|mjs|jsx|ts|tsx|json)$/.test(path)) return javascript();
  return [];
}

// CodeMirror's default look is already light, so "light mode" is just the
// absence of the oneDark theme extension — no second CDN package needed.
export function createEditorView({ parent, path, content, isDark, onChange }) {
  const state = EditorState.create({
    doc: content,
    extensions: [
      basicSetup,
      keymap.of([indentWithTab]),
      isDark ? oneDark : [],
      langExtensionFor(path),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(update.state.doc.toString());
      }),
    ],
  });
  return new EditorView({ state, parent });
}
