import React from "react";

/**
 * Custom window controls for the frameless Tauri window.
 * Falls back to no-ops when running in a plain browser (vite dev in Chrome).
 */
async function getWindow() {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow();
  } catch {
    return null;
  }
}

const TitleBar: React.FC<{ right?: React.ReactNode; documentName?: string }> = ({
  right,
  documentName = "ContentView.swift",
}) => {
  const minimize = async () => (await getWindow())?.minimize();
  const toggleMaximize = async () => (await getWindow())?.toggleMaximize();
  const close = async () => (await getWindow())?.close();

  return (
    <header
      data-tauri-drag-region
      className="relative flex h-11 shrink-0 select-none items-center justify-between border-b border-xcode-border bg-xcode-chrome px-3"
    >
      {/* macOS-style traffic lights */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={close}
          title="Close"
          aria-label="Close window"
          className="h-3 w-3 rounded-full bg-[#ff5f57] transition-opacity hover:opacity-80"
        />
        <button
          type="button"
          onClick={minimize}
          title="Minimize"
          aria-label="Minimize window"
          className="h-3 w-3 rounded-full bg-[#febc2e] transition-opacity hover:opacity-80"
        />
        <button
          type="button"
          onClick={toggleMaximize}
          title="Zoom"
          aria-label="Maximize window"
          className="h-3 w-3 rounded-full bg-[#28c840] transition-opacity hover:opacity-80"
        />
      </div>

      {/* Centered document title */}
      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[12px] font-medium text-xcode-textDim">
        SwiftCanvas — {documentName}
      </div>

      <div className="flex items-center gap-3 text-[11px] text-xcode-textDim">{right}</div>
    </header>
  );
};

export default TitleBar;
