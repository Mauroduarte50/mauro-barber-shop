import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SW_SOURCE = readFileSync(path.resolve(import.meta.dirname, "../public/sw.js"), "utf-8");

// Loads the actual public/sw.js against a minimal fake ServiceWorkerGlobalScope
// so a regression in its caching strategy is caught by `npm test`, not just
// by manually re-testing on a phone. This guards the bug fixed here: /api/*
// requests must never be looked up in (or written to) the Cache Storage —
// only network. See README "Bug: /reservar mostraba datos vacíos por IP de red".

type Handler = (event: unknown) => void;

function loadServiceWorker() {
  const listeners: Record<string, Handler> = {};
  const matchSpy = vi.fn(async () => undefined);
  const putSpy = vi.fn(async () => undefined);
  const cache = { match: matchSpy, put: putSpy, addAll: vi.fn(async () => undefined) };

  const fakeSelf = {
    addEventListener: (type: string, handler: Handler) => {
      listeners[type] = handler;
    },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  const fakeCaches = {
    open: vi.fn(async () => cache),
    match: matchSpy,
    keys: vi.fn(async () => []),
    delete: vi.fn(async () => true),
  };
  const fakeFetch = vi.fn(async () => ({ ok: true, clone: () => ({}) }));

  // sw.js is a plain (non-module) script that references the ServiceWorker
  // globals directly; run it in a function scope bound to our fakes instead
  // of touching real globalThis (avoids leaking `self`/`caches` across tests).
  const run = new Function("self", "caches", "fetch", `${SW_SOURCE}\n//# sourceURL=sw.js`);
  run(fakeSelf, fakeCaches, fakeFetch);

  return { listeners, matchSpy, putSpy };
}

function makeEvent(url: string, opts: { method?: string; mode?: string } = {}) {
  let respondWithArg: unknown;
  const event = {
    request: { url, method: opts.method ?? "GET", mode: opts.mode ?? "same-origin" },
    respondWith: (p: unknown) => {
      respondWithArg = p;
    },
    waitUntil: (_p: unknown) => {},
  };
  return { event, getResponded: () => respondWithArg };
}

describe("service worker fetch strategy (public/sw.js)", () => {
  let ctx: ReturnType<typeof loadServiceWorker>;

  beforeEach(() => {
    ctx = loadServiceWorker();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never consults the cache for /api/* requests — always network", async () => {
    const fetchHandler = ctx.listeners["fetch"];
    const { event, getResponded } = makeEvent("http://192.168.1.7:3000/api/public/config");
    fetchHandler(event);
    // No respondWith call at all means the browser handles it natively (pure network).
    expect(getResponded()).toBeUndefined();
    expect(ctx.matchSpy).not.toHaveBeenCalled();
  });

  it("never consults the cache for /api/public/services either", async () => {
    const fetchHandler = ctx.listeners["fetch"];
    const { event } = makeEvent("http://192.168.1.7:3000/api/public/services");
    fetchHandler(event);
    expect(ctx.matchSpy).not.toHaveBeenCalled();
  });

  it("still serves static /_next/static assets cache-first", async () => {
    const fetchHandler = ctx.listeners["fetch"];
    const { event, getResponded } = makeEvent("http://192.168.1.7:3000/_next/static/chunks/app.js");
    fetchHandler(event);
    expect(getResponded()).toBeDefined();
    await getResponded();
    expect(ctx.matchSpy).toHaveBeenCalled();
  });

  it("ignores non-GET requests (e.g. POST bookings) entirely", async () => {
    const fetchHandler = ctx.listeners["fetch"];
    const { event, getResponded } = makeEvent("http://192.168.1.7:3000/api/public/bookings", { method: "POST" });
    fetchHandler(event);
    expect(getResponded()).toBeUndefined();
  });
});
