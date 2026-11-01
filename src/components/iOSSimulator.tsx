import React from "react";
import type { PreviewRuntime } from "../utils/swift/viewBuilder";
import SwiftPreview from "./SwiftPreview";

export interface DeviceSpec {
  name: string;
  /** Logical points, matching the real device. */
  width: number;
  height: number;
  /** Safe-area insets in points. */
  safeTop: number;
  safeBottom: number;
  scale: number;
}

export const DEVICES: DeviceSpec[] = [
  { name: "iPhone 15 Pro", width: 393, height: 852, safeTop: 59, safeBottom: 34, scale: 3 },
  { name: "iPhone 15 Pro Max", width: 430, height: 932, safeTop: 59, safeBottom: 34, scale: 3 },
  { name: "iPhone SE (3rd gen)", width: 375, height: 667, safeTop: 20, safeBottom: 0, scale: 2 },
];

export interface ISSimulatorProps {
  runtime: PreviewRuntime;
  device: DeviceSpec;
  isRunning?: boolean;
  /** Incremented by Run, restarting the preview with fresh state. */
  runToken?: number;
  onLog?: (message: string) => void;
}

const BEZEL_PX = 14;
const MIN_SCALE = 0.2;
const MAX_SCALE = 1;

/** iOS-style status bar indicators. */
const StatusIcons: React.FC<{ color: string }> = ({ color }) => (
  <div className="flex items-center gap-[5px]">
    <div className="flex items-end gap-[1.5px]" aria-hidden="true">
      {[3, 5, 7, 9].map((height) => (
        <span key={height} className="w-[3px] rounded-[1px]" style={{ height, background: color }} />
      ))}
    </div>

    <svg viewBox="0 0 16 12" aria-hidden="true" className="h-[11px] w-[15px]">
      <path
        d="M1.4 4.2a9.4 9.4 0 0 1 13.2 0M3.8 6.6a6 6 0 0 1 8.4 0M6.1 9a2.7 2.7 0 0 1 3.8 0"
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="8" cy="10.6" r="0.9" fill={color} />
    </svg>

    <div className="flex items-center gap-[1px]" aria-hidden="true">
      <div className="relative h-[11px] w-[22px] rounded-[3px] border p-[1.5px]" style={{ borderColor: color }}>
        <div className="h-full w-[72%] rounded-[1.5px]" style={{ background: color }} />
      </div>
      <div className="h-[4px] w-[1.5px] rounded-r-[1px]" style={{ background: color }} />
    </div>
  </div>
);

/**
 * Device mockup with the live SwiftUI preview. The device is measured against
 * the canvas and scaled with a CSS transform so it always fits without
 * scrolling, no matter how small the window is.
 */
const ISSimulator: React.FC<ISSimulatorProps> = ({
  runtime,
  device,
  isRunning = true,
  runToken = 0,
  onLog,
}) => {
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(0.72);

  const deviceWidth = device.width + BEZEL_PX * 2;
  const deviceHeight = device.height + BEZEL_PX * 2;
  const hasDynamicIsland = device.safeTop > 30;

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const update = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const availableWidth = Math.max(width - 40, 0);
      const availableHeight = Math.max(height - 66, 0);
      const fit = Math.min(
        availableWidth / deviceWidth,
        availableHeight / deviceHeight,
        MAX_SCALE,
      );
      setScale(Number.isFinite(fit) && fit > 0 ? Math.max(MIN_SCALE, fit) : MIN_SCALE);
    };

    update();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [deviceWidth, deviceHeight]);

  const zoom = Math.round(scale * 100);
  const statusColor = "#000";

  return (
    <div
      ref={canvasRef}
      className="flex h-full w-full select-none items-center justify-center overflow-hidden px-5 py-5"
    >
      <div className="flex flex-col items-center gap-2">
        {/* Box that occupies the scaled size, keeping flex centering exact. */}
        <div
          className="relative shrink-0"
          style={{ width: deviceWidth * scale, height: deviceHeight * scale }}
        >
          <div
            className="absolute left-1/2 top-1/2 origin-center"
            style={{
              width: deviceWidth,
              height: deviceHeight,
              transform: `translate(-50%, -50%) scale(${scale})`,
            }}
          >
            {/* Side buttons */}
            <span className="absolute -left-[2px] top-[128px] h-[24px] w-[3px] rounded-l-[2px] bg-[#2a2a2e] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]" />
            <span className="absolute -left-[2px] top-[184px] h-[48px] w-[3px] rounded-l-[2px] bg-[#2a2a2e] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]" />
            <span className="absolute -left-[2px] top-[242px] h-[48px] w-[3px] rounded-l-[2px] bg-[#2a2a2e] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]" />
            <span className="absolute -right-[2px] top-[206px] h-[62px] w-[3px] rounded-r-[2px] bg-[#2a2a2e] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]" />

            {/* Titanium bezel */}
            <div
              className="absolute inset-0 rounded-[54px] p-[14px] shadow-[0_36px_80px_-18px_rgba(0,0,0,0.6),0_12px_28px_rgba(0,0,0,0.35)] ring-1 ring-white/15"
              style={{
                background:
                  "linear-gradient(145deg, #5d5d63 0%, #1c1c20 18%, #08080a 55%, #2a2a2f 100%)",
              }}
            >
              {/* Screen */}
              <div className="relative h-full w-full overflow-hidden rounded-[42px] bg-white ring-1 ring-black/70">
                {/* SwiftUI preview output — fills the whole screen; the
                    preview honours the safe areas itself. */}
                <div className="absolute inset-0 select-text">
                  <SwiftPreview
                    key={`${device.name}:${runToken}`}
                    runtime={runtime}
                    onLog={onLog}
                    isRunning={isRunning}
                  />
                </div>

                {/* iOS status bar */}
                <div
                  className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between px-7 text-[12px] font-semibold tracking-[-0.01em]"
                  style={{ height: device.safeTop || 20, color: statusColor }}
                >
                  <span>9:41</span>
                  <StatusIcons color={statusColor} />
                </div>

                {/* Home indicator (devices with a home button do not have one) */}
                {hasDynamicIsland && (
                  <div className="pointer-events-none absolute bottom-[7px] left-1/2 z-30 h-[5px] w-[134px] -translate-x-1/2 rounded-full bg-black/85" />
                )}

                {/* Dynamic Island */}
                {hasDynamicIsland && (
                  <div className="pointer-events-none absolute left-1/2 top-[11px] z-40 h-[34px] w-[118px] -translate-x-1/2 rounded-full bg-black shadow-[inset_0_1px_2px_rgba(255,255,255,0.06)]">
                    <div className="absolute right-[11px] top-1/2 h-[8px] w-[8px] -translate-y-1/2 rounded-full bg-[#111114] ring-1 ring-white/[0.07]" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-[10.5px] leading-none text-[#5c5d62]">
          <span
            title={isRunning ? "Live preview" : "Preview paused"}
            className={`h-1.5 w-1.5 rounded-full ${
              isRunning ? "bg-[#30a14e]" : "bg-[#d09a1f]"
            }`}
          />
          <span className="font-medium">{device.name}</span>
          <span className="text-[#8a8b90]">iOS 17.5 · {zoom}%</span>
        </div>
      </div>
    </div>
  );
};

export default ISSimulator;
