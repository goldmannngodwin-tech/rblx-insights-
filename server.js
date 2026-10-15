const http = require("http");
const fs = require("fs");
const path = require("path");
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

async function roblox(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "RBLXInsights/1.0 (Roblox public experience stats viewer)" }
  });
  if (!response.ok) {
    const err = new Error(`Roblox API returned ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return response.json();
}

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(data));
}

async function api(req, res, url) {
  try {
    if (url.pathname === "/api/search") {
      const q = (url.searchParams.get("q") || "").trim();
      if (!q) return json(res, 400, { error: "Enter a Roblox game name to search." });
      if (q.length > 100) return json(res, 400, { error: "Search is too long." });
      const data = await roblox(
        "https://games.roblox.com/v1/games/search?keyword=" +
        encodeURIComponent(q) + "&limit=12&sortOrder=Desc"
      );
      return json(res, 200, { data: (data.data || []).map(g => ({
        universeId: g.id,
        placeId: g.rootPlaceId,
        name: g.name,
        description: g.description || "",
        playing: g.playing ?? null,
        visits: g.visits ?? null,
        maxPlayers: g.maxPlayers ?? null,
        creator: g.creator?.name || "Unknown creator",
        creatorType: g.creator?.type || "",
        thumbnail: null,
        totalUpVotes: g.totalUpVotes ?? null,
        totalDownVotes: g.totalDownVotes ?? null,
        created: g.created || null,
        updated: g.updated || null
      })) });
    }

    if (url.pathname === "/api/game") {
      const id = url.searchParams.get("id") || "";
      if (!/^\d{1,20}$/.test(id)) return json(res, 400, { error: "Use a numeric Roblox experience (universe) ID." });

      const [detailsResult, votesResult, thumbResult] = await Promise.allSettled([
        roblox("https://games.roblox.com/v1/games?universeIds=" + encodeURIComponent(id)),
        roblox("https://games.roblox.com/v1/games/" + encodeURIComponent(id) + "/votes"),
        roblox("https://thumbnails.roblox.com/v1/games/icons?universeIds=" + encodeURIComponent(id) + "&returnPolicy=PlaceHolder&size=512x512&format=Png&isCircular=false")
      ]);
      if (detailsResult.status !== "fulfilled" || !detailsResult.value.data?.[0]) {
        return json(res, 404, { error: "Could not find that public Roblox experience. Try searching its name or check the ID." });
      }
      const g = detailsResult.value.data[0];
      const votes = votesResult.status === "fulfilled" ? votesResult.value : {};
      const thumb = thumbResult.status === "fulfilled" ? thumbResult.value.data?.[0]?.imageUrl : null;
      const up = votes.upVotes ?? g.totalUpVotes ?? null;
      const down = votes.downVotes ?? g.totalDownVotes ?? null;
      return json(res, 200, {
        universeId: g.id,
        placeId: g.rootPlaceId,
        name: g.name,
        description: g.description || "",
        playing: g.playing ?? null,
        visits: g.visits ?? null,
        favoritedCount: g.favoritedCount ?? null,
        maxPlayers: g.maxPlayers ?? null,
        creator: g.creator?.name || "Unknown creator",
        creatorType: g.creator?.type || "",
        created: g.created || null,
        updated: g.updated || null,
        genre: g.genre || null,
        thumbnail: thumb,
        upVotes: up,
        downVotes: down,
        likeRatio: (up != null && down != null && up + down > 0) ? up / (up + down) * 100 : null,
        fetchedAt: new Date().toISOString()
      });
    }
    if (url.pathname === "/api/thumbnail") {
      const id = url.searchParams.get("id") || "";
      if (!/^\\d{1,20}$/.test(id)) return json(res, 400, { error: "Invalid experience ID." });
      const data = await roblox("https://thumbnails.roblox.com/v1/games/icons?universeIds=" + encodeURIComponent(id) + "&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false");
      return json(res, 200, { url: data.data?.[0]?.imageUrl || null });
    }
    return json(res, 404, { error: "Unknown API route." });
  } catch (e) {
    const status = e.status === 429 ? 503 : 502;
    return json(res, status, {
      error: e.status === 429
        ? "Roblox is rate-limiting requests right now. Wait a moment and try again."
        : "Couldn't reach Roblox's public API right now. Please try again shortly.",
      detail: process.env.NODE_ENV === "development" ? e.message : undefined
    });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) return api(req, res, url);

  let file = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const full = path.resolve(PUBLIC, file);
  if (!full.startsWith(path.resolve(PUBLIC) + path.sep) && full !== path.resolve(PUBLIC, "index.html")) {
    res.writeHead(403); return res.end("Forbidden");
  }
  fs.readFile(full, (err, content) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": mime[path.extname(full)] || "application/octet-stream" });
    res.end(content);
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`RBLX Insights running at http://localhost:${PORT}`));
