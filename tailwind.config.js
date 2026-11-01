/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        /*
         * Xcode Dark (Default) palette, sampled from the real editor chrome so
         * the IDE shell reads as authentic rather than "generic dark theme".
         */
        xcode: {
          window: "#323232",
          chrome: "#3a3a3c",
          chromeAlt: "#2c2c2e",
          toolbar: "#3f3f41",
          editor: "#1f1f24",
          gutter: "#1a1a1e",
          panel: "#26262a",
          border: "#1c1c1f",
          divider: "#4a4a4d",
          text: "#dfdfe0",
          textDim: "#9a9a9e",
          accent: "#0a84ff",
          selection: "#2f4f8f",
          currentLine: "#2a2a30",
        },
        /*
         * Syntax tokens matching Xcode Dark's Swift grammar.
         */
        swift: {
          keyword: "#fc5fa3",
          type: "#5dd8ff",
          string: "#fc6a5d",
          number: "#d0bf69",
          comment: "#6c7986",
          function: "#41a1c0",
          property: "#67b7a4",
          attribute: "#ffa500",
        },
      },
      fontFamily: {
        mono: [
          "SF Mono",
          "Menlo",
          "Monaco",
          "Cascadia Code",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
        ui: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "Segoe UI",
          "Inter",
          "sans-serif",
        ],
      },
      fontSize: {
        "editor": ["13px", { lineHeight: "20px" }],
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(2px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-slow": {
          "0%, 100%": { opacity: "0.45" },
          "50%": { opacity: "0.9" },
        },
      },
      animation: {
        "fade-in": "fade-in 160ms ease-out",
        "pulse-slow": "pulse-slow 2.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
