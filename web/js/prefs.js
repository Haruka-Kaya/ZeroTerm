// Per-browser display preferences (theme, font size, panels, tool buttons).
//
// These never reach the Pi: they describe how this browser draws the terminal,
// not how the device runs. Device settings live behind /api/config.

const STORAGE_KEY = "zeroterm-prefs";

export const DEFAULT_TOOLS = [
  { label: "wifite", command: "wifite" },
  { label: "hcxdump", command: "hcxdumptool" },
  { label: "bettercap", command: "bettercap" },
  { label: "htop", command: "htop" },
];

export const DEFAULTS = {
  theme: "midnight",
  fontSize: 14,
  keyBar: true,
  sidePanel: true,
  cursorBlink: true,
  tools: DEFAULT_TOOLS,
};

export const THEMES = [
  { id: "midnight", label: "Midnight" },
  { id: "slate", label: "Slate" },
  { id: "paper", label: "Paper (light)" },
  { id: "contrast", label: "High contrast" },
];

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 24;

function clampFontSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size)) {
    return DEFAULTS.fontSize;
  }
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(size)));
}

function sanitizeTools(value) {
  if (!Array.isArray(value)) {
    return DEFAULT_TOOLS.slice();
  }
  const tools = [];
  for (const entry of value.slice(0, 12)) {
    if (!entry || typeof entry.command !== "string") {
      continue;
    }
    const command = entry.command.trim();
    if (!command) {
      continue;
    }
    const label = typeof entry.label === "string" && entry.label.trim()
      ? entry.label.trim().slice(0, 16)
      : command.split(/\s+/)[0].slice(0, 16);
    tools.push({ label, command: command.slice(0, 200) });
  }
  return tools;
}

function sanitize(raw) {
  const prefs = { ...DEFAULTS, ...(raw && typeof raw === "object" ? raw : {}) };
  return {
    theme: THEMES.some((t) => t.id === prefs.theme) ? prefs.theme : DEFAULTS.theme,
    fontSize: clampFontSize(prefs.fontSize),
    keyBar: Boolean(prefs.keyBar),
    sidePanel: Boolean(prefs.sidePanel),
    cursorBlink: Boolean(prefs.cursorBlink),
    tools: sanitizeTools(prefs.tools),
  };
}

export function loadPrefs() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return sanitize(raw ? JSON.parse(raw) : null);
  } catch (error) {
    return sanitize(null);
  }
}

export function savePrefs(prefs) {
  const clean = sanitize(prefs);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  } catch (error) {
    // Storage unavailable; the prefs still apply for this page load.
  }
  return clean;
}

/** Push preferences into the document so CSS can act on them. */
export function applyPrefs(prefs) {
  const root = document.documentElement;
  root.dataset.theme = prefs.theme;
  root.dataset.keybar = prefs.keyBar ? "on" : "off";
  root.dataset.panel = prefs.sidePanel ? "on" : "off";
  root.dataset.blink = prefs.cursorBlink ? "on" : "off";
  root.style.setProperty("--term-font-size", `${prefs.fontSize}px`);
}
