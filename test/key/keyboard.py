"""One virtual keyboard for a key-test session, kept for the whole session.

It speaks the Wayland wire protocol itself (standard library only) and uploads the committed US keymap
us.xkb once, so every key has its real evdev code and the keymap never changes under Firefox.

Keyboard mode (the default): each stdin line is {"id": n, "args": [wtype-style args]}, and each reply line is
{"id": n, "ok": true, "sent": keys} or {"id": n, "ok": false, "error": "..."}. A reply comes after a
wl_display.sync round trip, so the compositor has taken every event by then. The first line out is {"ready": true}.
Tap mode (--tap KEYSYM): one press and release, then exit. The session driver wakes the host compositor with it.

A lost compositor ends the process with a message on stderr and exit code 3, so the harness fails the case by
name and never sends into nothing.
"""

import json
import os
import re
import selectors
import socket
import struct
import sys
import time
from pathlib import Path

KEYMAP_PATH = Path(__file__).with_name("us.xkb")
KEYMAP_FORMAT_XKB_V1 = 1
KEY_RELEASED, KEY_PRESSED = 0, 1
# A pause after each key. Without it the keys arrive faster than a person types, and pieces that type text and
# then an action key in one call race the page: the action key lands before the text took effect. wtype paced
# about 5 ms a character. Slice 7b of the key-test speed plan makes those call sites wait for the effect, then drops this gap.
KEY_GAP_MS = 10
EXIT_COMPOSITOR_LOST = 3
EXIT_PROTOCOL_ERROR = 4

# wtype's modifier names, as the pieces write them, to the key that holds each and its real modifier mask.
MODIFIERS = {"shift": ("Shift_L", 1 << 0), "ctrl": ("Control_L", 1 << 2), "alt": ("Alt_L", 1 << 3), "logo": ("Super_L", 1 << 6), "win": ("Super_L", 1 << 6)}
SHIFT_MASK = MODIFIERS["shift"][1]

ASCII_KEYSYMS = {
    " ": "space", "!": "exclam", '"': "quotedbl", "#": "numbersign", "$": "dollar", "%": "percent", "&": "ampersand",
    "'": "apostrophe", "(": "parenleft", ")": "parenright", "*": "asterisk", "+": "plus", ",": "comma", "-": "minus",
    ".": "period", "/": "slash", ":": "colon", ";": "semicolon", "<": "less", "=": "equal", ">": "greater",
    "?": "question", "@": "at", "[": "bracketleft", "\\": "backslash", "]": "bracketright", "^": "asciicircum",
    "_": "underscore", "`": "grave", "{": "braceleft", "|": "bar", "}": "braceright", "~": "asciitilde",
    "\n": "Return", "\t": "Tab",
}


class KeyRequestError(Exception):
    """A request the keymap or the grammar cannot serve. It fails that request, never the session."""


def keysym_of_character(character):
    if character.isascii() and character.isalnum():
        return character
    if character in ASCII_KEYSYMS:
        return ASCII_KEYSYMS[character]
    raise KeyRequestError(f"no key for character {character!r}: the keyboard types ASCII only")


def key_table(keymap_text):
    """Maps each keysym of the keymap to (evdev code, needs Shift).

    The first key that carries a keysym wins, and the main block comes before the keypad in the keymap, so
    `minus` is the main minus key. Level two counts as Shift only on keys with no explicit type, where it is.
    """
    keycodes = {name: int(code) for name, code in re.findall(r"^\s*<(\w+)>\s*=\s*(\d+);", keymap_text, re.M)}
    for alias, target in re.findall(r"^\s*alias\s*<(\w+)>\s*=\s*<(\w+)>;", keymap_text, re.M):
        if target in keycodes:
            keycodes[alias] = keycodes[target]
    symbols_section = keymap_text[keymap_text.index("xkb_symbols"):]
    table = {}
    for name, body in re.findall(r"^\s*key <(\w+)>\s*\{(.*?)\};", symbols_section, re.M | re.S):
        if name not in keycodes:
            continue
        levels = re.search(r"(?:symbols\[\d+\]\s*=\s*)?\[([^\]]*)\]", body)
        if not levels:
            continue
        keysyms = [keysym.strip() for keysym in levels.group(1).split(",")]
        code = keycodes[name] - 8
        if keysyms and keysyms[0] not in table:
            table[keysyms[0]] = (code, False)
        if len(keysyms) > 1 and "type" not in body and keysyms[1] not in table:
            table[keysyms[1]] = (code, True)
    return table


def parse_wtype_args(args):
    """Turns wtype-style args into steps: ("tap", keysym), ("press", keysym), ("release", keysym),
    ("mod_down", name), ("mod_up", name), ("sleep", ms). Text becomes one tap per character, with the -d delay between."""
    steps = []
    delay_ms = 0
    index = 0

    def value_of(flag):
        nonlocal index
        if index + 1 >= len(args):
            raise KeyRequestError(f"{flag} needs a value")
        index += 1
        return args[index]

    while index < len(args):
        arg = args[index]
        if arg in ("-M", "-m"):
            modifier = value_of(arg)
            if modifier not in MODIFIERS:
                raise KeyRequestError(f"unknown modifier {modifier!r}")
            steps.append(("mod_down" if arg == "-M" else "mod_up", modifier))
        elif arg in ("-k", "-P", "-p"):
            steps.append(({"-k": "tap", "-P": "press", "-p": "release"}[arg], value_of(arg)))
        elif arg in ("-d", "-s"):
            text = value_of(arg)
            if not text.isdigit():
                raise KeyRequestError(f"{arg} needs whole milliseconds, got {text!r}")
            if arg == "-d":
                delay_ms = int(text)
            else:
                steps.append(("sleep", int(text)))
        elif arg == "-":
            raise KeyRequestError("text from stdin (-) is not supported")
        elif arg.startswith("-") and len(arg) > 1:
            raise KeyRequestError(f"unknown option {arg!r}")
        else:
            for position, character in enumerate(arg):
                if position > 0 and delay_ms > 0:
                    steps.append(("sleep", delay_ms))
                steps.append(("tap", keysym_of_character(character)))
        index += 1
    return steps


class Wayland:
    def __init__(self, display):
        path = display if display.startswith("/") else os.path.join(os.environ["XDG_RUNTIME_DIR"], display)
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect(path)
        self.buffer = b""
        self.free_ids = []
        self.next_id = 2
        self.handlers = {}
        self.handlers[1] = self.on_display_event

    def new_id(self):
        if self.free_ids:
            return self.free_ids.pop()
        object_id = self.next_id
        self.next_id += 1
        return object_id

    def send(self, object_id, opcode, payload=b"", fds=()):
        message = struct.pack("<II", object_id, ((8 + len(payload)) << 16) | opcode) + payload
        try:
            if fds:
                socket.send_fds(self.sock, [message], list(fds))
            else:
                self.sock.sendall(message)
        except OSError as error:
            die(EXIT_COMPOSITOR_LOST, f"the compositor connection failed: {error}")

    def on_display_event(self, opcode, payload):
        if opcode == 0:
            object_id, code = struct.unpack_from("<II", payload)
            die(EXIT_PROTOCOL_ERROR, f"protocol error on object {object_id}, code {code}: {read_string(payload, 8)}")
        if opcode == 1:
            (object_id,) = struct.unpack_from("<I", payload)
            self.handlers.pop(object_id, None)
            self.free_ids.append(object_id)

    def read_events(self):
        try:
            chunk = self.sock.recv(65536)
        except OSError as error:
            die(EXIT_COMPOSITOR_LOST, f"the compositor connection failed: {error}")
        if not chunk:
            die(EXIT_COMPOSITOR_LOST, "the compositor closed the connection")
        self.buffer += chunk
        while len(self.buffer) >= 8:
            object_id, size_opcode = struct.unpack_from("<II", self.buffer)
            size = size_opcode >> 16
            if len(self.buffer) < size:
                break
            payload = self.buffer[8:size]
            self.buffer = self.buffer[size:]
            handler = self.handlers.get(object_id)
            if handler:
                handler(size_opcode & 0xFFFF, payload)

    def roundtrip(self):
        callback = self.new_id()
        done = []
        self.handlers[callback] = lambda opcode, payload: done.append(True)
        self.send(1, 0, struct.pack("<I", callback))
        while not done:
            self.read_events()


def read_string(payload, offset):
    (length,) = struct.unpack_from("<I", payload, offset)
    return payload[offset + 4:offset + 4 + length - 1].decode(errors="replace")


def pack_string(text):
    data = text.encode() + b"\0"
    return struct.pack("<I", len(data)) + data + b"\0" * (-len(data) % 4)


def die(code, message):
    print(f"keyboard.py: {message}", file=sys.stderr, flush=True)
    sys.exit(code)


class VirtualKeyboard:
    def __init__(self, wayland, keymap_text):
        self.wayland = wayland
        self.table = key_table(keymap_text)
        self.started_at = time.monotonic()
        self.depressed = 0
        self.held_keys = set()
        globals_seen = {}
        registry = wayland.new_id()
        wayland.handlers[registry] = lambda opcode, payload: opcode == 0 and globals_seen.setdefault(read_string(payload, 4), struct.unpack_from("<I", payload)[0])
        wayland.send(1, 1, struct.pack("<I", registry))
        wayland.roundtrip()
        for interface in ("wl_seat", "zwp_virtual_keyboard_manager_v1"):
            if interface not in globals_seen:
                die(EXIT_PROTOCOL_ERROR, f"the compositor offers no {interface}")
        seat = self.bind(registry, globals_seen["wl_seat"], "wl_seat", 1)
        manager = self.bind(registry, globals_seen["zwp_virtual_keyboard_manager_v1"], "zwp_virtual_keyboard_manager_v1", 1)
        self.keyboard = wayland.new_id()
        wayland.send(manager, 0, struct.pack("<II", seat, self.keyboard))
        keymap_bytes = keymap_text.encode() + b"\0"
        keymap_fd = os.memfd_create("desertfox-keymap", os.MFD_CLOEXEC)
        os.write(keymap_fd, keymap_bytes)
        wayland.send(self.keyboard, 0, struct.pack("<II", KEYMAP_FORMAT_XKB_V1, len(keymap_bytes)), fds=[keymap_fd])
        os.close(keymap_fd)
        wayland.roundtrip()

    def bind(self, registry, name, interface, version):
        object_id = self.wayland.new_id()
        self.wayland.send(registry, 0, struct.pack("<I", name) + pack_string(interface) + struct.pack("<II", version, object_id))
        return object_id

    def lookup(self, keysym):
        if keysym not in self.table:
            raise KeyRequestError(f"no key for keysym {keysym!r} in us.xkb")
        return self.table[keysym]

    def key(self, code, state):
        elapsed_ms = int((time.monotonic() - self.started_at) * 1000) & 0xFFFFFFFF
        self.wayland.send(self.keyboard, 1, struct.pack("<III", elapsed_ms, code, state))
        if state == KEY_PRESSED:
            self.held_keys.add(code)
        else:
            self.held_keys.discard(code)

    def modifiers(self, depressed):
        self.depressed = depressed
        self.wayland.send(self.keyboard, 2, struct.pack("<IIII", depressed, 0, 0, 0))

    # A modifier goes down as a real key and as modifier state, so the page sees a Shift or Control keydown as a person's would send.
    def modifier(self, name, down):
        keysym, mask = MODIFIERS[name]
        code, _ = self.lookup(keysym)
        if down == bool(self.depressed & mask):
            return
        self.key(code, KEY_PRESSED if down else KEY_RELEASED)
        self.modifiers(self.depressed | mask if down else self.depressed & ~mask)

    def tap(self, keysym):
        code, needs_shift = self.lookup(keysym)
        added_shift = needs_shift and not self.depressed & SHIFT_MASK
        if added_shift:
            self.modifier("shift", True)
            self.wayland.roundtrip()
        self.key(code, KEY_PRESSED)
        self.wayland.roundtrip()
        self.key(code, KEY_RELEASED)
        self.wayland.roundtrip()
        if added_shift:
            self.modifier("shift", False)
            self.wayland.roundtrip()
        time.sleep(KEY_GAP_MS / 1000)

    def run(self, steps):
        for kind, value in steps:
            if kind == "sleep":
                time.sleep(value / 1000)
            elif kind == "tap":
                self.tap(value)
            elif kind in ("press", "release"):
                self.key(self.lookup(value)[0], KEY_PRESSED if kind == "press" else KEY_RELEASED)
                self.wayland.roundtrip()
            else:
                self.modifier(value, kind == "mod_down")
                self.wayland.roundtrip()
        return sum(1 for kind, _ in steps if kind in ("tap", "press"))

    # wtype ends each run by destroying its keyboard, which lets go of every held key. One keyboard for the
    # whole session has to do that by hand, or a -M without its -m would hold the modifier into the next call.
    def release_all(self):
        for code in list(self.held_keys):
            self.key(code, KEY_RELEASED)
        if self.depressed:
            self.modifiers(0)
        self.wayland.roundtrip()


def reply(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def answer_request(keyboard, line):
    request_id = None
    try:
        request = json.loads(line)
        request_id = request.get("id")
        steps = parse_wtype_args(request["args"])
        # A bad key fails the whole call before any of it is sent.
        for kind, value in steps:
            if kind in ("tap", "press", "release"):
                keyboard.lookup(value)
        sent = keyboard.run(steps)
        keyboard.release_all()
        reply({"id": request_id, "ok": True, "sent": sent})
    except (KeyRequestError, ValueError, KeyError, TypeError, AttributeError) as error:
        reply({"id": request_id, "ok": False, "error": str(error)})


# stdin is read raw, not through sys.stdin, whose buffer would hide a second queued line from select.
def serve(keyboard, wayland):
    selector = selectors.DefaultSelector()
    selector.register(0, selectors.EVENT_READ, "stdin")
    selector.register(wayland.sock, selectors.EVENT_READ, "wayland")
    pending = b""
    reply({"ready": True})
    while True:
        for selected, _ in selector.select():
            if selected.data == "wayland":
                wayland.read_events()
                continue
            chunk = os.read(0, 65536)
            if not chunk:
                return
            pending += chunk
            while b"\n" in pending:
                line, pending = pending.split(b"\n", 1)
                if line.strip():
                    answer_request(keyboard, line.decode())


def main(argv):
    display = os.environ.get("WAYLAND_DISPLAY")
    if not display:
        die(2, "WAYLAND_DISPLAY is not set")
    try:
        wayland = Wayland(display)
    except OSError as error:
        die(EXIT_COMPOSITOR_LOST, f"cannot connect to {display}: {error}")
    keyboard = VirtualKeyboard(wayland, KEYMAP_PATH.read_text())
    if len(argv) == 2 and argv[0] == "--tap":
        keyboard.run([("tap", argv[1])])
        return
    if argv:
        die(2, "usage: keyboard.py [--tap KEYSYM]")
    serve(keyboard, wayland)


if __name__ == "__main__":
    main(sys.argv[1:])
