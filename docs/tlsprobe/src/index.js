import { connect } from "cloudflare:sockets";

const HOSTS = [
  "example.com", "cloudflare.com", "www.sanity.io",
  "api.sanity.io", "85i3osnk.api.sanity.io",
  "85i3osnk.apicdn.sanity.io", "cdn.sanity.io", "github.com",
];
const SIZES = [300, 1700, 2500];
const TIMEOUT = 10000;

const u16 = (n) => [(n >> 8) & 255, n & 255];
const ext = (t, b) => [...u16(t), ...u16(b.length), ...b];
const rnd = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a]; };
const enc = new TextEncoder();

// Minimal, valid TLS1.3 ClientHello (x25519 key_share, classical groups only),
// padded via extension 21 to an exact target byte length.
function clientHello(host, targetSize) {
  const name = [...enc.encode(host)];
  const base = [
    ...ext(0, [...u16(name.length + 3), 0, ...u16(name.length), ...name]),  // SNI
    ...ext(10, [...u16(4), ...u16(0x001d), ...u16(0x0017)]),                // supported_groups
    ...ext(11, [1, 0]),                                                      // ec_point_formats
    ...ext(13, [...u16(6), ...u16(0x0403), ...u16(0x0804), ...u16(0x0401)]), // sig_algs
    ...ext(43, [2, 3, 4]),                                                   // supported_versions
    ...ext(51, [...u16(36), ...u16(0x001d), ...u16(32), ...rnd(32)]),        // key_share
    ...ext(16, [...u16(9), 8, ...enc.encode("http/1.1")]),                   // ALPN
  ];
  const assemble = (pad) => {
    const e = pad >= 0 ? [...base, ...ext(21, new Array(pad).fill(0))] : base;
    const body = [3, 3, ...rnd(32), 0, ...u16(8),
      0x13, 0x01, 0x13, 0x02, 0x13, 0x03, 0xc0, 0x2f, 1, 0, ...u16(e.length), ...e];
    const hs = [1, (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255, ...body];
    return new Uint8Array([0x16, 3, 1, ...u16(hs.length), ...hs]);
  };
  const pad = targetSize - assemble(-1).length - 4;
  return assemble(pad > 0 ? pad : -1);
}

const deadline = () => new Promise((_, rej) => setTimeout(() => rej(new Error("read timeout")), TIMEOUT));
const err = (e, t0) => `${e.name || "Error"}: ${e.message} (${Date.now() - t0}ms)`;

// Probe A: fetch() — exercises the zone's outbound TLS path.
async function probeFetch(host) {
  const t0 = Date.now();
  try {
    const r = await fetch(`https://${host}/`, { method: "GET" });
    return `HTTP ${r.status} (${Date.now() - t0}ms) ray=${r.headers.get("cf-ray") || "-"}`;
  } catch (e) { return err(e, t0); }
}

// Probe B: connect(secureTransport:"on") — runtime does TLS, bypassing fetch().
async function probeSocketTls(host) {
  const t0 = Date.now(); let s;
  try {
    s = connect({ hostname: host, port: 443 }, { secureTransport: "on" });
    const w = s.writable.getWriter();
    await w.write(enc.encode(`HEAD / HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`));
    const { value } = await Promise.race([s.readable.getReader().read(), deadline()]);
    return `${new TextDecoder().decode(value).split("\r\n")[0]} (${Date.now() - t0}ms)`;
  } catch (e) { return err(e, t0); }
  finally { try { await s?.close(); } catch {} }
}

function pqHello(host) {
  const name = [...enc.encode(host)];
  const e = [
    ...ext(0, [...u16(name.length + 3), 0, ...u16(name.length), ...name]),
    ...ext(10, [...u16(2), ...u16(0x11ec)]),                                 // only X25519MLKEM768
    ...ext(13, [...u16(6), ...u16(0x0403), ...u16(0x0804), ...u16(0x0401)]),
    ...ext(43, [2, 3, 4]),
    ...ext(51, [...u16(0)]),                                                 // empty key_share -> HRR
  ];
  const body = [3, 3, ...rnd(32), 0, ...u16(6), 0x13, 0x01, 0x13, 0x02, 0x13, 0x03,
    1, 0, ...u16(e.length), ...e];
  const hs = [1, (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255, ...body];
  return new Uint8Array([0x16, 3, 1, ...u16(hs.length), ...hs]);
}

// Probe D: does the origin support PQ key agreement, as seen from this colo?
async function probePQ(host) {
  const t0 = Date.now(); let s;
  try {
    s = connect({ hostname: host, port: 443 }, { secureTransport: "off" });
    const w = s.writable.getWriter();
    await w.write(pqHello(host));
    const { value, done } = await Promise.race([s.readable.getReader().read(), deadline()]);
    const dt = Date.now() - t0;
    if (done || !value?.length) return `EMPTY/FIN (${dt}ms)`;
    if (value[0] === 0x16) return `PQ-SUPPORTED (HRR/SH) (${dt}ms)`;
    if (value[0] === 0x15) return `PQ-UNSUPPORTED alert=${value[6] ?? "?"} (${dt}ms)`;
    return `?? 0x${value[0].toString(16)} (${dt}ms)`;
  } catch (e) { return err(e, t0); }
  finally { try { await s?.close(); } catch {} }
}

function pqFullHello(host) {
  const name = [...enc.encode(host)];
  const share = rnd(1216);
  const e = [
    ...ext(0, [...u16(name.length + 3), 0, ...u16(name.length), ...name]),
    ...ext(10, [...u16(4), ...u16(0x11ec), ...u16(0x001d)]),
    ...ext(13, [...u16(6), ...u16(0x0403), ...u16(0x0804), ...u16(0x0401)]),
    ...ext(43, [2, 3, 4]),
    ...ext(51, [...u16(1220), ...u16(0x11ec), ...u16(1216), ...share]),
  ];
  const body = [3, 3, ...rnd(32), 0, ...u16(6), 0x13, 0x01, 0x13, 0x02, 0x13, 0x03,
    1, 0, ...u16(e.length), ...e];
  const hs = [1, (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255, ...body];
  return new Uint8Array([0x16, 3, 1, ...u16(hs.length), ...hs]);
}

async function probePQFull(host) {
  const t0 = Date.now(); let s;
  try {
    s = connect({ hostname: host, port: 443 }, { secureTransport: "off" });
    const w = s.writable.getWriter();
    const h = pqFullHello(host);
    await w.write(h);
    const { value, done } = await Promise.race([s.readable.getReader().read(), deadline()]);
    const dt = Date.now() - t0;
    const tag = `[${h.length}B hello]`;
    if (done || !value?.length) return `EMPTY/FIN ${tag} (${dt}ms)`;
    if (value[0] === 0x16) return `ACCEPTED ${tag} (${dt}ms)`;
    if (value[0] === 0x15) return `ALERT ${value[6] ?? "?"} ${tag} (${dt}ms)`;
    return `?? 0x${value[0].toString(16)} ${tag} (${dt}ms)`;
  } catch (e) { return err(e, t0); }
  finally { try { await s?.close(); } catch {} }
}

// Probe C: raw TCP + our own ClientHello — tests the network path only.
async function probeRaw(host, size) {
  const t0 = Date.now(); let s;
  try {
    s = connect({ hostname: host, port: 443 }, { secureTransport: "off" });
    const w = s.writable.getWriter();
    await w.write(clientHello(host, size));
    const { value, done } = await Promise.race([s.readable.getReader().read(), deadline()]);
    const dt = Date.now() - t0;
    if (done || !value?.length) return `EMPTY/FIN (${dt}ms)`;
    const hex = [...value.slice(0, 8)].map((x) => x.toString(16).padStart(2, "0")).join("");
    if (value[0] === 0x16) return `OK ServerHello (${dt}ms)`;
    if (value[0] === 0x15) return `ALERT ${hex} (${dt}ms)`;
    return `?? ${hex} (${dt}ms)`;
  } catch (e) { return err(e, t0); }
  finally { try { await s?.close(); } catch {} }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const hosts = url.searchParams.get("hosts")?.split(",") || HOSTS;
    const want = (url.searchParams.get("probes") || "A,B,C,D,E").split(",");
    const results = {};
    for (const h of hosts) {
      const o = {};
      if (want.includes("A")) o["A_fetch"] = await probeFetch(h);
      if (want.includes("B")) o["B_socket_tls"] = await probeSocketTls(h);
      if (want.includes("D")) o["D_origin_pq_support"] = await probePQ(h);
      if (want.includes("E")) o["E_pq_full_clienthello"] = await probePQFull(h);
      if (want.includes("C")) {
        const raw = {};
        for (const sz of SIZES) raw[`${sz}B`] = await probeRaw(h, sz);
        o["C_raw_clienthello"] = raw;
      }
      results[h] = o;
    }
    return Response.json({
      worker: env.LABEL || "unknown",
      hostname: url.hostname,
      colo: request.cf?.colo,
      ray: request.headers.get("cf-ray"),
      time: new Date().toISOString(),
      results,
    }, { headers: { "cache-control": "no-store" } });
  },
};
