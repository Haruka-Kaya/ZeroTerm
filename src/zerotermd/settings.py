"""Editable device settings exposed through /api/config.

Only keys listed in ``FIELDS`` can be read or written. Everything else in the
environment file stays invisible to the API, so a typo in the browser cannot
introduce an arbitrary variable into the unit environment.
"""

from __future__ import annotations

from dataclasses import dataclass


# Values are written into an EnvironmentFile that systemd also parses, so keep
# them free of quoting and expansion characters.
_FORBIDDEN_TEXT_CHARS = set("\"'\\`$\r\n")

_IFACE_ALLOWED = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")

BOOL_TRUE = {"1", "true", "yes", "on"}
BOOL_FALSE = {"0", "false", "no", "off"}


@dataclass(frozen=True)
class Field:
    """One editable setting and everything the UI needs to render it."""

    key: str
    label: str
    group: str
    kind: str  # bool | int | choice | text | iface
    default: str = ""
    help: str = ""
    choices: tuple[str, ...] = ()
    minimum: int | None = None
    maximum: int | None = None
    # Service that must be restarted for a change to take effect.
    # "status" is restarted automatically; "terminal" is only reported, because
    # restarting it would drop the very session issuing the request.
    applies_to: str = "status"
    placeholder: str = ""


GROUPS: tuple[tuple[str, str], ...] = (
    ("terminal", "Terminal"),
    ("network", "Network"),
    ("power", "Power"),
    ("display", "e-Paper"),
)


FIELDS: tuple[Field, ...] = (
    # -- Terminal ---------------------------------------------------------
    Field(
        key="ZEROTERM_SHELL",
        label="Login shell",
        group="terminal",
        kind="text",
        default="/bin/bash",
        help="Program started for each new session.",
        applies_to="terminal",
        placeholder="/bin/bash",
    ),
    Field(
        key="ZEROTERM_SHELL_CMD",
        label="Shell command",
        group="terminal",
        kind="text",
        help="Overrides the shell entirely. Set to 'tmux new -A -s zeroterm' "
        "to keep the session alive across reconnects.",
        applies_to="terminal",
        placeholder="tmux new -A -s zeroterm",
    ),
    Field(
        key="ZEROTERM_TERM",
        label="TERM",
        group="terminal",
        kind="choice",
        default="linux",
        choices=("linux", "xterm", "xterm-256color", "vt100"),
        help="Terminal type advertised to the shell.",
        applies_to="terminal",
    ),
    Field(
        key="ZEROTERM_SESSION_RESUME",
        label="Resume sessions",
        group="terminal",
        kind="bool",
        default="1",
        help="Re-attach to the running shell after a dropped connection.",
        applies_to="terminal",
    ),
    Field(
        key="ZEROTERM_SESSION_TTL",
        label="Session TTL (s)",
        group="terminal",
        kind="int",
        default="60",
        minimum=0,
        maximum=86400,
        help="How long a detached shell is kept before it is killed.",
        applies_to="terminal",
    ),
    Field(
        key="ZEROTERM_LOG_LEVEL",
        label="Log level",
        group="terminal",
        kind="choice",
        default="info",
        choices=("debug", "info", "warning", "error"),
        applies_to="terminal",
    ),
    # -- Network ----------------------------------------------------------
    Field(
        key="ZEROTERM_STATUS_IFACE",
        label="Wi-Fi interface",
        group="network",
        kind="iface",
        default="wlan0",
        help="Interface reported in telemetry and on the e-Paper display.",
        placeholder="wlan0",
    ),
    Field(
        key="ZEROTERM_STATUS_IFACE_AUTO",
        label="Auto-select interface",
        group="network",
        kind="bool",
        default="0",
        help="Prefer an external adapter when one is present.",
    ),
    Field(
        key="ZEROTERM_MONITOR_IFACE",
        label="Monitor-mode interface",
        group="network",
        kind="iface",
        help="Interface the MON ON/OFF buttons act on. Defaults to the Wi-Fi "
        "interface above.",
        placeholder="wlan0",
    ),
    Field(
        key="ZEROTERM_STATUS_WIFI_SSID",
        label="Show SSID",
        group="network",
        kind="bool",
        default="1",
        help="Read the associated SSID. Turn off to skip an iw call per refresh.",
    ),
    # -- Power ------------------------------------------------------------
    Field(
        key="ZEROTERM_STATUS_PROFILE",
        label="Power preset",
        group="power",
        kind="choice",
        default="",
        choices=("", "eco", "balanced", "performance"),
        help="Empty means the system default is left untouched.",
    ),
    Field(
        key="ZEROTERM_STATUS_LOW_BATTERY",
        label="Low battery (%)",
        group="power",
        kind="int",
        default="20",
        minimum=0,
        maximum=100,
        help="Threshold for the low-battery face and refresh interval.",
    ),
    Field(
        key="ZEROTERM_STATUS_LOW_BATTERY_INTERVAL",
        label="Low battery interval (s)",
        group="power",
        kind="int",
        default="0",
        minimum=0,
        maximum=86400,
        help="Refresh interval below the threshold. 0 keeps the normal interval.",
    ),
    Field(
        key="ZEROTERM_BATTERY_LOG_INTERVAL",
        label="Battery log interval (s)",
        group="power",
        kind="int",
        default="300",
        minimum=0,
        maximum=86400,
        help="0 disables battery CSV logging.",
    ),
    # -- e-Paper ----------------------------------------------------------
    Field(
        key="ZEROTERM_EPAPER_DRIVER",
        label="Driver",
        group="display",
        kind="choice",
        default="waveshare",
        choices=("waveshare", "file", "null"),
        help="'file' writes a PNG instead of driving a panel; 'null' disables it.",
    ),
    Field(
        key="ZEROTERM_EPAPER_MODEL",
        label="Panel model",
        group="display",
        kind="text",
        default="epd2in13_V3",
        placeholder="epd2in13_V3",
    ),
    Field(
        key="ZEROTERM_EPAPER_FONT_SIZE",
        label="Font size",
        group="display",
        kind="int",
        default="14",
        minimum=8,
        maximum=32,
    ),
    Field(
        key="ZEROTERM_STATUS_INTERVAL",
        label="Refresh interval (s)",
        group="display",
        kind="int",
        default="30",
        minimum=5,
        maximum=86400,
        help="e-Paper panels wear out; keep this as high as you can tolerate.",
    ),
    Field(
        key="ZEROTERM_STATUS_NIGHT_START",
        label="Night start (hour)",
        group="display",
        kind="int",
        default="22",
        minimum=0,
        maximum=23,
    ),
    Field(
        key="ZEROTERM_STATUS_NIGHT_END",
        label="Night end (hour)",
        group="display",
        kind="int",
        default="6",
        minimum=0,
        maximum=23,
    ),
    Field(
        key="ZEROTERM_STATUS_NIGHT_INTERVAL",
        label="Night interval (s)",
        group="display",
        kind="int",
        default="0",
        minimum=0,
        maximum=86400,
        help="Refresh interval during night hours. 0 keeps the normal interval.",
    ),
)


FIELDS_BY_KEY: dict[str, Field] = {item.key: item for item in FIELDS}


class ValidationError(ValueError):
    """A submitted value did not fit its field."""


def _validate_bool(value: object) -> str:
    if isinstance(value, bool):
        return "1" if value else "0"
    text = str(value).strip().lower()
    if text in BOOL_TRUE:
        return "1"
    if text in BOOL_FALSE:
        return "0"
    raise ValidationError("expected a boolean")


def _validate_int(item: Field, value: object) -> str:
    text = str(value).strip()
    if text == "":
        raise ValidationError("expected a number")
    try:
        number = int(text, 10)
    except ValueError:
        raise ValidationError("expected a number") from None
    if item.minimum is not None and number < item.minimum:
        raise ValidationError(f"must be at least {item.minimum}")
    if item.maximum is not None and number > item.maximum:
        raise ValidationError(f"must be at most {item.maximum}")
    return str(number)


def _validate_choice(item: Field, value: object) -> str:
    text = str(value).strip()
    if text not in item.choices:
        allowed = ", ".join(repr(choice) for choice in item.choices)
        raise ValidationError(f"must be one of {allowed}")
    return text


def _validate_text(value: object) -> str:
    text = str(value).strip()
    if len(text) > 200:
        raise ValidationError("must be 200 characters or fewer")
    for char in text:
        if char in _FORBIDDEN_TEXT_CHARS or ord(char) < 0x20 or ord(char) == 0x7F:
            raise ValidationError("contains an unsupported character")
    return text


def _validate_iface(value: object) -> str:
    text = str(value).strip()
    if text == "":
        return ""
    if len(text) > 32:
        raise ValidationError("must be 32 characters or fewer")
    if any(char not in _IFACE_ALLOWED for char in text):
        raise ValidationError("may only contain letters, digits, '.', '_' and '-'")
    return text


def validate(key: str, value: object) -> str:
    """Return the normalized env-file value, or raise ValidationError."""
    item = FIELDS_BY_KEY.get(key)
    if item is None:
        raise ValidationError("unknown setting")
    if value is None:
        value = ""
    if item.kind == "bool":
        return _validate_bool(value)
    if item.kind == "int":
        return _validate_int(item, value)
    if item.kind == "choice":
        return _validate_choice(item, value)
    if item.kind == "iface":
        return _validate_iface(value)
    return _validate_text(value)


def validate_all(values: dict[str, object]) -> tuple[dict[str, str], dict[str, str]]:
    """Validate a whole submission.

    Returns ``(accepted, errors)``. Nothing is written when ``errors`` is
    non-empty, so a single bad field never leaves the device half-configured.
    """
    accepted: dict[str, str] = {}
    errors: dict[str, str] = {}
    for key, value in values.items():
        try:
            accepted[key] = validate(key, value)
        except ValidationError as exc:
            errors[key] = str(exc)
    return accepted, errors


def describe() -> list[dict[str, object]]:
    """Field metadata for the settings UI."""
    described: list[dict[str, object]] = []
    for item in FIELDS:
        entry: dict[str, object] = {
            "key": item.key,
            "label": item.label,
            "group": item.group,
            "kind": item.kind,
            "default": item.default,
            "applies_to": item.applies_to,
        }
        if item.help:
            entry["help"] = item.help
        if item.choices:
            entry["choices"] = list(item.choices)
        if item.minimum is not None:
            entry["minimum"] = item.minimum
        if item.maximum is not None:
            entry["maximum"] = item.maximum
        if item.placeholder:
            entry["placeholder"] = item.placeholder
        described.append(entry)
    return described


def groups() -> list[dict[str, str]]:
    return [{"id": group_id, "label": label} for group_id, label in GROUPS]
