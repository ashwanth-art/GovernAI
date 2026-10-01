/**
 * Node HTTP entry point.
 *
 * The build targets Cloudflare Workers, but it emits a plain fetch handler with no
 * `cloudflare:` imports — which is why `tests/harness.mjs` can import it under Node.
 * This file supplies the three things the Workers runtime would otherwise provide:
 * the `ASSETS` static-asset binding, an `IMAGES` transformer, and an `ExecutionContext`.
 *
 * Response bodies are streamed rather than buffered. The live run screen depends on it:
 * `/api/assessments/stream` emits server-sent events for two minutes, and buffering the
 * body would hold every event until the run finished and leave the screen blank.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import handler from "../dist/server/index.js";

const ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const CLIENT_DIR = join(ROOT, "dist", "client");
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";

const CONTENT_TYPES = new Map(
  Object.entries({
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".otf": "font/otf",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8",
    ".wasm": "application/wasm",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  }),
);

/** Cloudflare-specific files the static handler must never serve. */
const HIDDEN = new Set(["_headers", "_redirects", ".assetsignore"]);

/**
 * Resolve a URL path to a file inside dist/client, or null.
 *
 * Rejects anything that escapes the directory once normalised, so an encoded
 * `../` in a request path cannot read outside the build output.
 */
async function resolveAsset(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null; // malformed percent-encoding
  }
  const relative = normalize(decoded).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  if (!relative || HIDDEN.has(relative)) return null;

  const candidate = join(CLIENT_DIR, relative);
  if (candidate !== CLIENT_DIR && !candidate.startsWith(CLIENT_DIR + sep)) return null;

  try {
    const info = await stat(candidate);
    return info.isFile() ? { path: candidate, size: info.size } : null;
  } catch {
    return null;
  }
}

/** Stands in for the Workers ASSETS binding. */
const assets = {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    const asset = await resolveAsset(pathname);
    if (!asset) return new Response("Not found", { status: 404 });

    const headers = {
      "content-type": CONTENT_TYPES.get(extname(asset.path).toLowerCase()) ?? "application/octet-stream",
      "content-length": String(asset.size),
      // Everything under /assets carries a content hash in its name, so it can be
      // cached hard. Everything else (favicon, og image) must be revalidated.
      "cache-control": pathname.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "public, max-age=0, must-revalidate",
    };
    if (request.method === "HEAD") return new Response(null, { headers });
    return new Response(Readable.toWeb(createReadStream(asset.path)), { headers });
  },
};

/**
 * Stands in for the Workers IMAGES binding, backed by sharp.
 *
 * Only `/_vinext/image` reaches this. The shape mirrors the fluent Workers API that
 * worker/index.ts calls, so the handler needs no change.
 */
const images = {
  input(stream) {
    return {
      transform(options) {
        return {
          async output({ format, quality }) {
            const { default: sharp } = await import("sharp");
            const source = Buffer.from(await new Response(stream).arrayBuffer());
            let pipe = sharp(source);
            if (options.width) pipe = pipe.resize({ width: options.width, withoutEnlargement: true });
            const type = format.replace(/^image\//, "");
            const encoded = await pipe.toFormat(type, { quality }).toBuffer();
            return {
              response: () =>
                new Response(encoded, {
                  headers: {
                    "content-type": `image/${type}`,
                    "cache-control": "public, max-age=31536000, immutable",
                  },
                }),
            };
          },
        };
      },
    };
  },
};

/** Node has no waitUntil, so background promises are tracked and errors surfaced. */
function executionContext() {
  return {
    waitUntil(promise) {
      Promise.resolve(promise).catch((error) => {
        console.error("[waitUntil]", error);
      });
    },
    passThroughOnException() {},
  };
}

function toRequest(nodeRequest) {
  const host = nodeRequest.headers.host ?? `localhost:${PORT}`;
  const protocol = nodeRequest.headers["x-forwarded-proto"]?.split(",")[0]?.trim() || "http";
  const url = new URL(nodeRequest.url, `${protocol}://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeRequest.headers)) {
    if (value === undefined || key.startsWith(":")) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(key, item);
  }

  const hasBody = nodeRequest.method !== "GET" && nodeRequest.method !== "HEAD";
  return new Request(url, {
    method: nodeRequest.method,
    headers,
    body: hasBody ? Readable.toWeb(nodeRequest) : undefined,
    duplex: hasBody ? "half" : undefined,
  });
}

const server = createServer(async (nodeRequest, nodeResponse) => {
  try {
    const request = toRequest(nodeRequest);

    /* Static assets are matched before the handler runs, because that is what the
       Workers runtime does: Cloudflare's asset router answers /assets/* itself and
       the worker never sees the request. Calling the handler first instead makes it
       404 every hashed bundle — the shell renders and the page stays unstyled. */
    let response = null;
    if (request.method === "GET" || request.method === "HEAD") {
      const candidate = await assets.fetch(request);
      if (candidate.status === 200) response = candidate;
    }
    response ??= await handler.fetch(
      request,
      { ASSETS: assets, IMAGES: images },
      executionContext(),
    );

    const headers = Object.fromEntries(response.headers);
    // Proxies between the client and here must not buffer the SSE stream either.
    if (headers["content-type"]?.includes("text/event-stream")) {
      headers["cache-control"] = "no-cache, no-transform";
      headers["x-accel-buffering"] = "no";
    }
    nodeResponse.writeHead(response.status, headers);

    if (!response.body) {
      nodeResponse.end();
      return;
    }
    // pipeline() propagates client disconnects back to the stream, so an abandoned
    // run stops being written to instead of throwing on every subsequent event.
    await pipeline(Readable.fromWeb(response.body), nodeResponse);
  } catch (error) {
    console.error("[request]", nodeRequest.method, nodeRequest.url, error);
    if (!nodeResponse.headersSent) {
      nodeResponse.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    }
    nodeResponse.end("Internal Server Error");
  }
});

// A Tier 3 run can hold a request open for minutes; the 2-minute Node default would
// cut it off mid-stream. Headers still time out, so a stalled client cannot pin a socket.
server.requestTimeout = 0;
server.headersTimeout = 60_000;
server.keepAliveTimeout = 75_000;

server.listen(PORT, HOST, () => {
  console.log(`ARQ Governance listening on http://${HOST}:${PORT}`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`${signal} received, closing.`);
    server.close(() => process.exit(0));
    // Container Apps sends SIGTERM then waits; don't outlast its grace period.
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
