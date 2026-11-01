import React from "react";
import type { ProjectFileKind } from "../data/projectTree";

const PAGE =
  "M3.2 1.6h6.3L12.8 5v9.4H3.2z";

/** Disclosure triangle used by the project navigator. */
export const ChevronIcon: React.FC<{ open?: boolean }> = ({ open = false }) => (
  <svg
    viewBox="0 0 10 10"
    aria-hidden="true"
    className={`h-2.5 w-2.5 shrink-0 text-xcode-textDim transition-transform duration-150 ${
      open ? "rotate-90" : ""
    }`}
  >
    <path
      d="M3.4 1.9 6.6 5l-3.2 3.1"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Classic macOS blue folder. */
export const FolderIcon: React.FC = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 shrink-0">
    <path
      d="M1.6 3.9c0-.5.4-.9.9-.9h3.1l1.3 1.5h5.7c.5 0 .9.4.9.9v7.2c0 .5-.4.9-.9.9H2.5c-.5 0-.9-.4-.9-.9z"
      fill="#3E8EF7"
    />
    <path
      d="M1.6 6.1h12.9v6.5c0 .5-.4.9-.9.9H2.5c-.5 0-.9-.4-.9-.9z"
      fill="#2B7BE0"
    />
    <path
      d="M2 6.35h12.1"
      stroke="#9CC7FF"
      strokeWidth="0.7"
      strokeLinecap="round"
    />
  </svg>
);

/** Asset catalog icon (blue tile with image glyph). */
export const AssetCatalogIcon: React.FC = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 shrink-0">
    <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="#2F7FE0" />
    <rect
      x="3.2"
      y="3.2"
      width="9.6"
      height="9.6"
      rx="1.8"
      fill="#1E63C4"
    />
    <circle cx="6" cy="6" r="1.15" fill="#EAF3FF" />
    <path
      d="M4.2 11.2 6.9 8.1l1.8 2.2 1.4-1.6 1.7 2.5z"
      fill="#EAF3FF"
    />
  </svg>
);

/** White page with the orange Swift mark. */
export const SwiftFileIcon: React.FC = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 shrink-0">
    <path
      d={PAGE}
      fill="#F7F7F9"
      stroke="#8E8E93"
      strokeWidth="0.6"
      strokeLinejoin="round"
    />
    <path
      d="M9.5 1.6V5h3.3"
      fill="#DCDCE0"
      stroke="#8E8E93"
      strokeWidth="0.6"
      strokeLinejoin="round"
    />
    <circle cx="9.6" cy="9.6" r="3.25" fill="#F05138" />
    <path
      d="M11.4 8.3c-.35-.55-1-.9-1.75-.9-1.05 0-1.8.55-1.8 1.2 0 .55.45.85 1.4 1.05.95.2 1.5.5 1.5 1.15 0 .75-.75 1.25-1.8 1.25-.85 0-1.6-.3-2-.85"
      fill="none"
      stroke="#FFFFFF"
      strokeWidth="0.95"
      strokeLinecap="round"
    />
  </svg>
);

/** Property list file. */
export const PlistFileIcon: React.FC = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 shrink-0">
    <path
      d={PAGE}
      fill="#F7F7F9"
      stroke="#8E8E93"
      strokeWidth="0.6"
      strokeLinejoin="round"
    />
    <path
      d="M9.5 1.6V5h3.3"
      fill="#DCDCE0"
      stroke="#8E8E93"
      strokeWidth="0.6"
      strokeLinejoin="round"
    />
    <path
      d="M5.1 7.4h5.8M5.1 9.2h5.8M5.1 11h3.7"
      stroke="#8E8E93"
      strokeWidth="0.75"
      strokeLinecap="round"
    />
  </svg>
);

/** JSON file. */
export const JsonFileIcon: React.FC = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 shrink-0">
    <path
      d={PAGE}
      fill="#F7F7F9"
      stroke="#8E8E93"
      strokeWidth="0.6"
      strokeLinejoin="round"
    />
    <path
      d="M9.5 1.6V5h3.3"
      fill="#DCDCE0"
      stroke="#8E8E93"
      strokeWidth="0.6"
      strokeLinejoin="round"
    />
    <text
      x="8"
      y="11.1"
      textAnchor="middle"
      fontSize="6.4"
      fontFamily="monospace"
      fontWeight="600"
      fill="#B78125"
    >
      {"{}"}
    </text>
  </svg>
);

/** Generic document with text lines. */
export const GenericFileIcon: React.FC = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 shrink-0">
    <path
      d={PAGE}
      fill="#F7F7F9"
      stroke="#8E8E93"
      strokeWidth="0.6"
      strokeLinejoin="round"
    />
    <path
      d="M9.5 1.6V5h3.3"
      fill="#DCDCE0"
      stroke="#8E8E93"
      strokeWidth="0.6"
      strokeLinejoin="round"
    />
    <path
      d="M5.1 7.6h5.8M5.1 9.4h5.8M5.1 11.2h3.7"
      stroke="#A0A0A5"
      strokeWidth="0.75"
      strokeLinecap="round"
    />
  </svg>
);

/** Built product (.app) icon. */
export const AppProductIcon: React.FC = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 shrink-0">
    <rect x="1.5" y="1.5" width="13" height="13" rx="3.4" fill="#3E8EF7" />
    <rect
      x="1.5"
      y="1.5"
      width="13"
      height="13"
      rx="3.4"
      fill="none"
      stroke="#A9CDFF"
      strokeWidth="0.7"
    />
    <path
      d="M4.4 10.8 7.2 5.2h1.6l2.8 5.6H9.9l-.5-1.1H6.6l-.5 1.1z"
      fill="#FFFFFF"
    />
  </svg>
);

export const FileTypeIcon: React.FC<{
  kind?: ProjectFileKind;
  isFolder?: boolean;
  name?: string;
}> = ({ kind, isFolder = false, name }) => {
  if (name?.endsWith(".app")) return <AppProductIcon />;
  if (kind === "asset") return <AssetCatalogIcon />;
  if (isFolder) return <FolderIcon />;
  if (kind === "swift") return <SwiftFileIcon />;
  if (kind === "plist") return <PlistFileIcon />;
  if (kind === "json") return <JsonFileIcon />;
  return <GenericFileIcon />;
};

/** Small folder-with-tab used by the navigator header. */
export const SidebarProjectIcon: React.FC = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
    <path
      d="M1.5 4.3c0-.5.4-.9.9-.9h3.2l1.2 1.4h5.8c.5 0 .9.4.9.9v6.6c0 .5-.4.9-.9.9H2.4c-.5 0-.9-.4-.9-.9z"
      fill="#8E8E93"
    />
    <path
      d="M1.5 6.3h13v6c0 .5-.4.9-.9.9H2.4c-.5 0-.9-.4-.9-.9z"
      fill="#6E6E73"
    />
  </svg>
);

/** Small horizontal ellipsis used by row action buttons. */
export const EllipsisIcon: React.FC = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
    <circle cx="3.4" cy="8" r="1.15" fill="currentColor" />
    <circle cx="8" cy="8" r="1.15" fill="currentColor" />
    <circle cx="12.6" cy="8" r="1.15" fill="currentColor" />
  </svg>
);

/** Document with a plus, used for "New File". */
export const NewFileIcon: React.FC = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
    <path
      d="M3.3 1.8h6.1L12.6 5v9.2H3.3z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinejoin="round"
    />
    <path
      d="M9.4 1.8V5h3.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinejoin="round"
    />
    <path
      d="M8 8.2v4.1M5.95 10.25h4.1"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
    />
  </svg>
);

/** Folder with a plus, used for "New Folder". */
export const NewFolderIcon: React.FC = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
    <path
      d="M1.6 3.9c0-.5.4-.9.9-.9h3.1l1.3 1.5h5.7c.5 0 .9.4.9.9v7.2c0 .5-.4.9-.9.9H2.5c-.5 0-.9-.4-.9-.9z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinejoin="round"
    />
    <path
      d="M8 7.2v4M6 9.2h4"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
    />
  </svg>
);

/** Pencil for rename actions. */
export const PencilIcon: React.FC = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
    <path
      d="m3 11.2-.6 2.4 2.4-.6 7-7a1.3 1.3 0 0 0-1.8-1.8z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinejoin="round"
    />
    <path d="m9.2 5.2 1.8 1.8" stroke="currentColor" strokeWidth="1.1" />
  </svg>
);

/** Trash can for delete actions. */
export const TrashIcon: React.FC = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
    <path
      d="M3.2 4.4h9.6M6.2 4.4V3.1h3.6v1.3M4.4 4.4l.6 9h6l.6-9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M6.7 7v4M9.3 7v4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
  </svg>
);

/** Smartphone outline for the preview canvas header. */
export const DeviceIcon: React.FC = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
    <rect
      x="3.4"
      y="1.4"
      width="9.2"
      height="13.2"
      rx="2.1"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
    />
    <path
      d="M6.6 3.1h2.8"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
    />
  </svg>
);
