import React from "react";
import Editor, { type OnMount, type BeforeMount } from "@monaco-editor/react";
import { SWIFT_LANGUAGE_ID, swiftMonarchLanguage, xcodeDarkTheme } from "../utils/swiftLanguage";
import type { editor as MonacoEditor } from "monaco-editor";

export interface MonacoEditorHandle {
  getInstance: () => MonacoEditor.IStandaloneCodeEditor | null;
  setValue: (value: string) => void;
  getValue: () => string;
  focus: () => void;
}

export interface CodeEditorProps {
  value: string;
  language?: string;
  readOnly?: boolean;
  minimap?: boolean;
  onMount?: (instance: MonacoEditor.IStandaloneCodeEditor) => void;
}

const CodeEditor = React.forwardRef<MonacoEditorHandle, CodeEditorProps>(
  function CodeEditor(
    { value, language = SWIFT_LANGUAGE_ID, readOnly = false, minimap = false, onMount },
    ref,
  ) {
    const instanceRef = React.useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);

    const handleBeforeMount: BeforeMount = (monaco) => {
      // Register the Swift grammar and the Xcode Dark theme once, before the
      // first editor is created.
      monaco.languages.register({ id: SWIFT_LANGUAGE_ID });
      monaco.languages.setMonarchTokensProvider(SWIFT_LANGUAGE_ID, swiftMonarchLanguage);
      monaco.languages.setLanguageConfiguration(SWIFT_LANGUAGE_ID, {
        comments: { lineComment: "//", blockComment: ["/*", "*/"] },
        brackets: [
          ["{", "}"],
          ["[", "]"],
          ["(", ")"],
        ],
        autoClosingPairs: [
          { open: "{", close: "}" },
          { open: "[", close: "]" },
          { open: "(", close: ")" },
          { open: '"', close: '"' },
        ],
        surroundingPairs: [
          { open: "{", close: "}" },
          { open: "[", close: "]" },
          { open: "(", close: ")" },
          { open: '"', close: '"' },
        ],
      });

      monaco.editor.defineTheme("xcode-dark", xcodeDarkTheme);
    };

    const handleMount: OnMount = (editorInstance) => {
      instanceRef.current = editorInstance;
      onMount?.(editorInstance);
    };

    React.useImperativeHandle(ref, () => ({
      getInstance: () => instanceRef.current,
      setValue: (next) => instanceRef.current?.setValue(next),
      getValue: () => instanceRef.current?.getValue() ?? "",
      focus: () => instanceRef.current?.focus(),
    }));

    return (
      <Editor
        height="100%"
        defaultLanguage={language}
        defaultValue={value}
        theme="xcode-dark"
        beforeMount={handleBeforeMount}
        onMount={handleMount}
        options={{
          readOnly,
          minimap: { enabled: minimap },
          fontFamily: "'SF Mono', Menlo, Monaco, 'Cascadia Code', Consolas, monospace",
          fontSize: 13,
          lineHeight: 20,
          tabSize: 4,
          insertSpaces: true,
          renderWhitespace: "boundary",
          bracketPairColorization: { enabled: false },
          guides: { indentation: true, bracketPairs: true },
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
          padding: { top: 8, bottom: 8 },
          smoothScrolling: true,
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          automaticLayout: true,
          scrollBeyondLastLine: false,
          contextmenu: true,
          lineNumbersMinChars: 4,
        }}
      />
    );
  },
);

export default CodeEditor;
