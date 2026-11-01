import React from "react";
import type { DeviceSpec } from "./iOSSimulator";

export interface XcodeToolbarProps {
  isRunning: boolean;
  onRun: () => void;
  onStop: () => void;
  showNavigator: boolean;
  showCanvas: boolean;
  showInspector: boolean;
  showDebug: boolean;
  onToggleNavigator: () => void;
  onToggleCanvas: () => void;
  onToggleInspector: () => void;
  onToggleDebug: () => void;
  diagnosticCount: number;
  devices: DeviceSpec[];
  device: DeviceSpec;
  onSelectDevice: (device: DeviceSpec) => void;
  onQuickOpen: () => void;
}

const ToolbarToggle: React.FC<{
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, active, onClick, children }) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    aria-pressed={active}
    onClick={onClick}
    className={`flex h-7 w-7 items-center justify-center rounded-[5px] transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-xcode-accent ${
      active
        ? "bg-white/15 text-xcode-text"
        : "text-xcode-textDim hover:bg-white/10 hover:text-xcode-text"
    }`}
  >
    {children}
  </button>
);

/** Small anchored dropdown used by the destination picker. */
const Dropdown: React.FC<{
  label: React.ReactNode;
  title: string;
  children: (close: () => void) => React.ReactNode;
}> = ({ label, title, children }) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-7 items-center gap-1.5 rounded-[5px] border border-white/10 bg-black/15 px-2 text-[11px] text-xcode-text transition-colors hover:bg-black/25 focus-visible:outline focus-visible:outline-1 focus-visible:outline-xcode-accent"
      >
        {label}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-[34px] z-[70] min-w-[190px] rounded-md border border-white/10 bg-[#2C2C30]/97 p-1 shadow-[0_18px_44px_rgba(0,0,0,0.55)] backdrop-blur"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
};

const MenuEntry: React.FC<{ selected?: boolean; onClick: () => void; children: React.ReactNode }> = ({
  selected = false,
  onClick,
  children,
}) => (
  <button
    type="button"
    role="menuitemradio"
    aria-checked={selected}
    onClick={onClick}
    className="flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[11.5px] text-xcode-text transition-colors hover:bg-xcode-accent hover:text-white"
  >
    <span className="w-3 shrink-0 text-[10px]">{selected ? "✓" : ""}</span>
    <span className="truncate">{children}</span>
  </button>
);

/**
 * Xcode-style window toolbar: run/stop, scheme, destination picker and the
 * pane visibility controls that drive the workspace layout.
 */
const XcodeToolbar: React.FC<XcodeToolbarProps> = ({
  isRunning,
  onRun,
  onStop,
  showNavigator,
  showCanvas,
  showInspector,
  showDebug,
  onToggleNavigator,
  onToggleCanvas,
  onToggleInspector,
  onToggleDebug,
  diagnosticCount,
  devices,
  device,
  onSelectDevice,
  onQuickOpen,
}) => (
  <div className="flex h-[46px] shrink-0 items-center gap-2 border-b border-black/50 bg-xcode-toolbar px-3">
    {/* Run / stop */}
    <button
      type="button"
      title="Run (Ctrl+R)"
      aria-label="Run"
      onClick={onRun}
      className={`flex h-7 w-8 items-center justify-center rounded-[5px] transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-xcode-accent ${
        isRunning ? "bg-[#2f7d32] text-white" : "text-[#67c46b] hover:bg-white/10"
      }`}
    >
      <svg viewBox="0 0 14 14" aria-hidden="true" className="h-3.5 w-3.5">
        <path d="M3.4 2.2 11.5 7l-8.1 4.8z" fill="currentColor" />
      </svg>
    </button>

    <button
      type="button"
      title="Stop (Ctrl+.)"
      aria-label="Stop"
      onClick={onStop}
      disabled={!isRunning}
      className="flex h-7 w-8 items-center justify-center rounded-[5px] text-[#ff6b60] transition-colors hover:bg-white/10 disabled:opacity-35 focus-visible:outline focus-visible:outline-1 focus-visible:outline-xcode-accent"
    >
      <svg viewBox="0 0 14 14" aria-hidden="true" className="h-3 w-3">
        <rect x="3" y="3" width="8" height="8" rx="1" fill="currentColor" />
      </svg>
    </button>

    <div className="mx-1 h-5 w-px bg-white/15" />

    {/* Scheme */}
    <div className="flex h-7 items-center gap-1.5 rounded-[5px] border border-white/10 bg-black/15 px-2 text-[11px] text-xcode-text">
      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5 text-[#f05138]">
        <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="currentColor" />
        <path
          d="M11.4 8.2c-.35-.55-1-.9-1.75-.9-1.05 0-1.8.55-1.8 1.2 0 .55.45.85 1.4 1.05.95.2 1.5.5 1.5 1.15 0 .75-.75 1.25-1.8 1.25-.85 0-1.6-.3-2-.85"
          fill="none"
          stroke="#fff"
          strokeWidth="0.95"
          strokeLinecap="round"
        />
      </svg>
      <span className="font-medium">SwiftCanvas</span>
    </div>

    {/* Destination picker */}
    <Dropdown
      title="Select a destination"
      label={
        <>
          <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
            <rect x="4" y="1.2" width="8" height="13.6" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1" />
            <path d="M7 3.4h2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          </svg>
          <span>{device.name}</span>
          <svg viewBox="0 0 8 8" aria-hidden="true" className="h-2 w-2 text-xcode-textDim">
            <path d="m1.4 2.7 2.6 2.6 2.6-2.6" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        </>
      }
    >
      {(close) => (
        <>
          <div className="px-2 pb-1 pt-0.5 text-[10px] uppercase tracking-[0.06em] text-xcode-textDim/80">
            Simulated device
          </div>
          {devices.map((entry) => (
            <MenuEntry
              key={entry.name}
              selected={entry.name === device.name}
              onClick={() => {
                onSelectDevice(entry);
                close();
              }}
            >
              {entry.name} · {entry.width}×{entry.height}
            </MenuEntry>
          ))}
        </>
      )}
    </Dropdown>

    {/* Build status */}
    <div className="ml-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-xcode-textDim">
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          diagnosticCount > 0 ? "bg-[#ffd60a]" : "bg-[#30d158]"
        }`}
      />
      <span>{isRunning ? "Running" : "Stopped"}</span>
    </div>

    <div className="ml-auto flex items-center gap-1">
      <button
        type="button"
        title="Open Quickly (Ctrl+P)"
        aria-label="Open Quickly"
        onClick={onQuickOpen}
        className="mr-1 flex h-7 items-center gap-1.5 rounded-[5px] border border-white/10 bg-black/15 px-2 text-[11px] text-xcode-textDim transition-colors hover:text-xcode-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-xcode-accent"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
          <circle cx="6.8" cy="6.8" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="m10.4 10.4 3.4 3.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        Open Quickly
      </button>

      <ToolbarToggle
        label="Toggle Project Navigator"
        active={showNavigator}
        onClick={onToggleNavigator}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
          <rect x="1.5" y="2" width="13" height="12" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1" />
          <path d="M5.6 2v12" stroke="currentColor" strokeWidth="1" />
          <path d="M3 4.6h1.4M3 6.6h1.4M3 8.6h1.4" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
        </svg>
      </ToolbarToggle>

      <ToolbarToggle
        label="Toggle Preview Canvas"
        active={showCanvas}
        onClick={onToggleCanvas}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
          <rect x="3.4" y="1.4" width="9.2" height="13.2" rx="2.1" fill="none" stroke="currentColor" strokeWidth="1.1" />
          <path d="M6.6 3.2h2.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
      </ToolbarToggle>

      <ToolbarToggle
        label="Toggle Inspector"
        active={showInspector}
        onClick={onToggleInspector}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
          <rect x="1.5" y="2" width="13" height="12" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1" />
          <path d="M10.4 2v12" stroke="currentColor" strokeWidth="1" />
          <path d="M11.9 5h1.2M11.9 7h1.2M11.9 9h1.2" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
        </svg>
      </ToolbarToggle>

      <ToolbarToggle
        label="Toggle Debug Area"
        active={showDebug}
        onClick={onToggleDebug}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
          <rect x="1.5" y="2" width="13" height="12" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1" />
          <path d="M1.5 10.2h13" stroke="currentColor" strokeWidth="1" />
          <path d="m4.4 5.4 1.4 1.4-1.4 1.4M7.6 8.2h3.2" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </ToolbarToggle>
    </div>
  </div>
);

export default XcodeToolbar;
