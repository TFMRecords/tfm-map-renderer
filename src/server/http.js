// HTTP front end of the render service (node:http, no framework). POST `/` or `/render` with `{ xml, ... }`; GET `/` usage, GET `/health`.
import http from "node:http";
import { RequestError } from "./render-service.js";

const SVG_TYPE = "image/svg+xml; charset=utf-8";
import { TEST_PAGE } from "./test-page.js";

const USAGE = `tfm-render-server

POST / (or /render)   Content-Type: application/json
{ "xml": "<C>...", "width": 800, "height": 400, "raw": false, "mirror": false, "options": { "minimalist": false, "objectMode": "editor", ... } }

Answer: JSON { "image": "<base64 png>", "mimeType": "image/png", "width", "height", "mapWidth", "mapHeight", "backend", "clientLoads", "warnings" }
        or the bare image/png with "raw": true. "svg": true adds the SVG text. "width" or "height" alone keep the aspect ratio; both stretch (fit: fill).
GET /health -> { ok: true, ... }
GET /test (or / in a browser) -> a page to paste XML + JSON config and see the result
`;

/**
 * @param {{render: Function, status: object}} service
 * @param {{maxBodyBytes?: number, cors?: boolean, info?: object}} [config]
 */
export function createRenderServer(service, { maxBodyBytes = 3_000_000, cors = true, info = {} } = {}) {
  const headers = (extra = {}) => ({ ...(cors ? { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, GET, OPTIONS", "access-control-expose-headers": "x-map-width, x-map-height, x-render-error" } : {}), ...extra });
  const send = (res, status, body, type = "application/json") => {
    const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, headers({ "content-type": type, "content-length": Buffer.byteLength(data) }));
    res.end(data);
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) { reject(new RequestError(`request body above ${maxBodyBytes} bytes`, 413)); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

  return http.createServer(async (req, res) => {
    let raw = false;
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "OPTIONS") { res.writeHead(204, headers()); res.end(); return; }
      if (req.method === "GET" && url.pathname === "/health") { send(res, 200, { ok: true, ...service.status, ...info }); return; }
      if (req.method === "GET" && (url.pathname === "/test" || (url.pathname === "/" && String(req.headers.accept ?? "").includes("text/html")))) { send(res, 200, TEST_PAGE, "text/html; charset=utf-8"); return; }
      if (req.method === "GET" && url.pathname === "/") { send(res, 200, USAGE, "text/plain; charset=utf-8"); return; }
      if (req.method === "POST" && (url.pathname === "/" || url.pathname === "/render")) {
        let body;
        try { body = JSON.parse(await readBody(req)); } catch (error) { if (error instanceof RequestError) throw error; throw new RequestError("the request body is not valid JSON"); }
        raw = body?.raw === true;
        const result = await service.render(body);
        const mapHeaders = { "x-map-width": String(result.mapWidth), "x-map-height": String(result.mapHeight) };
        if (raw && !result.png) {
          res.writeHead(200, headers({ "content-type": SVG_TYPE, "content-length": Buffer.byteLength(result.svg), ...mapHeaders }));
          res.end(result.svg);
          return;
        }
        if (raw) {
          res.writeHead(200, headers({ "content-type": "image/png", "content-length": result.png.length, ...mapHeaders }));
          res.end(result.png);
          return;
        }
        const { png, ...rest } = result;
        send(res, 200, png ? { image: png.toString("base64"), mimeType: "image/png", ...rest } : rest);
        return;
      }
      send(res, 404, { error: "not found" });
    } catch (error) {
      if (!(error instanceof RequestError)) console.error("render error:", error);
      const status = error instanceof RequestError ? error.status : 500;
      const message = error instanceof RequestError ? error.message : "internal error";
      // `svg: true` and the rasterizer failed: the error status, with the SVG (bare with `raw`, the error then in a header).
      const partial = error?.partial;
      if (partial && raw) {
        res.writeHead(status, headers({ "content-type": SVG_TYPE, "content-length": Buffer.byteLength(partial.svg), "x-render-error": message.replace(/[^\x20-\x7e]/g, "?") }));
        res.end(partial.svg);
        return;
      }
      send(res, status, partial ? { error: message, ...partial } : { error: message });
    }
  });
}
