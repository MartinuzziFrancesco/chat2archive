// Cloudflare Worker: the only piece of chat2archive that isn't a static
// asset. GitHub Pages can't run server code and the browser can't read a
// cross-origin fetch of chatgpt.com directly (CORS), so this is the
// smallest possible first-party stand-in — it fetches the public share
// page server-side and hands back parsed JSON. It owns no state and sees
// nothing but the share URL the user chose to paste.
//
// All of the actual parsing/validation logic lives in ../importers/share.ts
// and is unchanged from local/CLI use — this file is just the Workers
// `fetch` adapter and CORS headers around it.

import { fetchShare } from "../importers/share.js";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== "GET") {
      return new Response(null, { status: 405, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/api/share") {
      return new Response("Not found", { status: 404, headers: CORS_HEADERS });
    }

    const jsonHeaders = { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" };
    try {
      const imported = await fetchShare(url.searchParams.get("url") ?? "");
      return new Response(JSON.stringify(imported), { headers: jsonHeaders });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(JSON.stringify({ error: message }), { status: 422, headers: jsonHeaders });
    }
  },
};
