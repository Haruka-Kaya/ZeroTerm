// Keyboard translation: DOM key events and named keys -> PTY byte sequences.

/** Named sequences used by the on-screen key bar and the command palette. */
export const NAMED_KEYS = {
  esc: "\x1b",
  tab: "\t",
  enter: "\r",
  backspace: "\x7f",
  "ctrl-a": "\x01",
  "ctrl-c": "\x03",
  "ctrl-d": "\x04",
  "ctrl-e": "\x05",
  "ctrl-l": "\x0c",
  "ctrl-r": "\x12",
  "ctrl-u": "\x15",
  "ctrl-w": "\x17",
  "ctrl-z": "\x1a",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  home: "\x1b[H",
  end: "\x1b[F",
  pageup: "\x1b[5~",
  pagedown: "\x1b[6~",
  delete: "\x1b[3~",
  f1: "\x1bOP",
  f2: "\x1bOQ",
  f3: "\x1bOR",
  f4: "\x1bOS",
};

const SPECIAL_KEYS = {
  Enter: "\r",
  Backspace: "\x7f",
  Tab: "\t",
  Escape: "\x1b",
  Up: "\x1b[A",
  ArrowUp: "\x1b[A",
  Down: "\x1b[B",
  ArrowDown: "\x1b[B",
  Right: "\x1b[C",
  ArrowRight: "\x1b[C",
  Left: "\x1b[D",
  ArrowLeft: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
  Delete: "\x1b[3~",
  F1: "\x1bOP",
  F2: "\x1bOQ",
  F3: "\x1bOR",
  F4: "\x1bOS",
  F5: "\x1b[15~",
  F6: "\x1b[17~",
  F7: "\x1b[18~",
  F8: "\x1b[19~",
  F9: "\x1b[20~",
  F10: "\x1b[21~",
  F11: "\x1b[23~",
  F12: "\x1b[24~",
};

const LEGACY_KEYCODES = {
  37: "\x1b[D",
  38: "\x1b[A",
  39: "\x1b[C",
  40: "\x1b[B",
};

/**
 * Translate a keydown event into the bytes a PTY expects.
 * Returns null when the event carries no sequence of its own (plain typing,
 * which the hidden textarea delivers as an `input` event instead).
 */
export function mapKey(event) {
  // Alt/Meta as a prefix: ESC + key, the usual xterm convention.
  if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.length === 1) {
    return `\x1b${event.key}`;
  }

  if (event.ctrlKey && !event.altKey && !event.metaKey) {
    if (event.key === " ") {
      return "\x00";
    }
    if (event.key.length === 1) {
      const code = event.key.toUpperCase().charCodeAt(0);
      if (code >= 64 && code <= 95) {
        return String.fromCharCode(code - 64);
      }
    }
    return null;
  }

  const special = SPECIAL_KEYS[event.key];
  if (special) {
    return special;
  }

  if (event.keyCode && LEGACY_KEYCODES[event.keyCode]) {
    return LEGACY_KEYCODES[event.keyCode];
  }

  return null;
}
