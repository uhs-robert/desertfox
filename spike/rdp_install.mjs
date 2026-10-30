// Install the spike as a temporary add-on over Firefox's remote debugging protocol (what web-ext run does).
import net from "node:net";
const [port, addon_path] = process.argv.slice(2);
const sock = net.connect(Number(port), "127.0.0.1");
let buf = "", sent_root = false;
const send = (obj) => { const s = JSON.stringify(obj); sock.write(`${Buffer.byteLength(s)}:${s}`); };
sock.on("data", (d) => {
  buf += d.toString();
  for (;;) {
    const colon = buf.indexOf(":"); if (colon < 0) return;
    const len = Number(buf.slice(0, colon)); if (buf.length < colon + 1 + len) return;
    const msg = JSON.parse(buf.slice(colon + 1, colon + 1 + len)); buf = buf.slice(colon + 1 + len);
    if (!sent_root) { sent_root = true; send({ to: "root", type: "getRoot" }); }
    else if (msg.addonsActor) send({ to: msg.addonsActor, type: "installTemporaryAddon", addonPath: addon_path });
    else { console.log(JSON.stringify(msg)); process.exit(msg.addon ? 0 : 1); }
  }
});
sock.on("error", (e) => { console.error(e.message); process.exit(2); });
