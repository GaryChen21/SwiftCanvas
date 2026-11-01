import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import { loader } from "@monaco-editor/react";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

/**
 * Point @monaco-editor/react at the bundled `monaco-editor` package instead of
 * its default jsDelivr CDN loader. This keeps the app fully offline and lets
 * the Tauri CSP stay strict.
 *
 * Importing `editor.api` (rather than the package root) skips Monaco's
 * bundled basic-languages, which we do not need: Swift tokenization comes from
 * the Monarch grammar in swiftLanguage.ts.
 */
self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

loader.config({ monaco });

export { monaco };
