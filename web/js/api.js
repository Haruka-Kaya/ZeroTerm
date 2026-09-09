// Thin client for the zerotermd HTTP API.
//
// Every call resolves to null on failure: telemetry and settings must never
// be able to block or break the terminal itself.

async function requestJson(url, options) {
  try {
    const response = await fetch(url, { cache: "no-store", ...options });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, status: response.status, payload };
    }
    return { ok: true, status: response.status, payload };
  } catch (error) {
    return { ok: false, status: 0, payload: null };
  }
}

/** GET /api/status - battery, power, Wi-Fi telemetry. */
export async function fetchStatus() {
  const result = await requestJson("/api/status");
  return result.ok ? result.payload : null;
}

/** POST /api/power - switch the power preset. */
export async function setPowerProfile(profile) {
  const result = await requestJson("/api/power", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile }),
  });
  return result.ok ? result.payload : null;
}

/** GET /api/config - editable settings plus their metadata. */
export async function fetchConfig() {
  const result = await requestJson("/api/config");
  return result.ok ? result.payload : null;
}

/**
 * POST /api/config - persist changed settings.
 * Returns the server payload on success, or `{ok:false, error}` so the
 * settings panel can show why a value was rejected.
 */
export async function saveConfig(values) {
  const result = await requestJson("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  });
  if (result.ok) {
    return result.payload;
  }
  return {
    ok: false,
    error: (result.payload && result.payload.error) || "request failed",
    fields: (result.payload && result.payload.fields) || {},
  };
}
