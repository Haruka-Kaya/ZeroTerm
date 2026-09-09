// WebSocket transport to the PTY, with automatic reconnect.
//
// The link is the one thing a user always needs to know the state of, so the
// transport reports every change through `onState` instead of silently
// retrying in the background.

const SESSION_KEY = "zeroterm-session-id";
const MIN_DELAY = 1000;
const MAX_DELAY = 8000;

function generateSessionId() {
  if (window.crypto && window.crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Stable per-browser id so a dropped link re-attaches to the same shell. */
export function getSessionId() {
  try {
    const existing = window.localStorage.getItem(SESSION_KEY);
    if (existing) {
      return existing;
    }
    const next = generateSessionId();
    window.localStorage.setItem(SESSION_KEY, next);
    return next;
  } catch (error) {
    return null;
  }
}

/** Forget the current session id; the next connect starts a fresh shell. */
export function resetSessionId() {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch (error) {
    // Storage is unavailable (private mode); nothing to forget.
  }
}

export class Transport {
  /**
   * @param {{onData: (bytes: Uint8Array) => void,
   *          onState: (state: string, detail?: string) => void}} handlers
   */
  constructor(handlers) {
    this.onData = handlers.onData;
    this.onState = handlers.onState;
    this.encoder = new TextEncoder();
    this.socket = null;
    this.delay = MIN_DELAY;
    this.retryTimer = null;
    this.closed = false;
    this.state = "idle";
  }

  get isOpen() {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  _setState(state, detail) {
    this.state = state;
    this.onState(state, detail);
  }

  connect() {
    this.closed = false;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.socket) {
      // Drop the old socket's handlers so its close does not schedule a retry.
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      try {
        this.socket.close();
      } catch (error) {
        // Already closing.
      }
      this.socket = null;
    }

    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const sessionId = getSessionId();
    const query = sessionId ? `?session=${encodeURIComponent(sessionId)}` : "";
    this._setState("connecting");

    const socket = new WebSocket(`${protocol}://${location.host}/ws${query}`);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.onopen = () => {
      this.delay = MIN_DELAY;
      this._setState("connected");
    };
    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        return;
      }
      this.onData(new Uint8Array(event.data));
    };
    socket.onerror = () => {
      this._setState("error");
    };
    socket.onclose = (event) => {
      this.socket = null;
      if (this.closed) {
        this._setState("closed");
        return;
      }
      // 1008/409 means another tab holds this session; say so rather than
      // hammering the server with retries the user cannot interpret.
      const busy = event.code === 1008;
      this._setState("reconnecting", busy ? "session busy" : undefined);
      this.retryTimer = setTimeout(() => this.connect(), this.delay);
      this.delay = Math.min(MAX_DELAY, Math.round(this.delay * 1.5));
    };
  }

  /** Stop retrying and drop the link. */
  disconnect() {
    this.closed = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch (error) {
        // Already closing.
      }
    }
  }

  /** Reconnect immediately instead of waiting out the backoff. */
  reconnectNow() {
    this.delay = MIN_DELAY;
    this.connect();
  }

  send(text) {
    if (!this.isOpen) {
      return false;
    }
    this.socket.send(this.encoder.encode(text));
    return true;
  }

  sendResize(cols, rows) {
    if (!this.isOpen) {
      return false;
    }
    this.socket.send(JSON.stringify({ type: "resize", cols, rows }));
    return true;
  }
}
