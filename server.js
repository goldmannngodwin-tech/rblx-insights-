
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

async function roblox(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; RBLXInsights/1.0)"
    },
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    const error = new Error(`Roblox returned HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

function sendJSON(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });

  res.end(JSON.stringify(data));
}

function getErrorMessage(error) {
  if (error.status === 429) {
    return "Roblox is rate-limiting requests. Please wait and try again.";
  }

  if (error.status === 403) {
    return "Roblox denied the request. Please try again later.";
  }

  if (error.name === "TimeoutError" ||
      error.name === "AbortError") {
    return "Roblox took too long to respond. Please try again.";
  }

  return "Roblox's public API could not be reached. Try again shortly.";
}

async function handleAPI(req, res, url) {
  try {
    // Health check
    if (url.pathname === "/api/health") {
      return sendJSON(res, 200, {
        status: "ok",
        service: "RBLX Insights",
        time: new Date().toISOString()
      });
    }

    // Search Roblox games
    if (url.pathname === "/api/search") {
      const keyword = (url.searchParams.get("q") || "").trim();

      if (!keyword) {
        return sendJSON(res, 400, {
          error: "Enter a Roblox game name."
        });
      }

      if (keyword.length > 100) {
        return sendJSON(res, 400, {
          error: "Search must be 100 characters or fewer."
        });
      }

      const endpoint =
        "https://games.roblox.com/v1/games/search?keyword=" +
        encodeURIComponent(keyword) +
        "&limit=12&sortOrder=Desc";

      const result = await roblox(endpoint);

      const games = (result.data || []).map(game => ({
        universeId: game.id,
        placeId: game.rootPlaceId,
        name: game.name,
        description: game.description || "",
        playing: game.playing ?? null,
        visits: game.visits ?? null,
        maxPlayers: game.maxPlayers ?? null,
        creator: game.creator?.name || "Unknown creator",
        creatorType: game.creator?.type || "",
        thumbnail: null,
        totalUpVotes: game.totalUpVotes ?? null,
        totalDownVotes: game.totalDownVotes ?? null,
        created: game.created || null,
        updated: game.updated || null
      }));

      return sendJSON(res, 200, {
        data: games,
        count: games.length
      });
    }

    // Get detailed game statistics
    if (url.pathname === "/api/game") {
      const id = url.searchParams.get("id") || "";

      if (!/^\d{1,20}$/.test(id)) {
        return sendJSON(res, 400, {
          error: "Enter a valid numeric Roblox experience ID."
        });
      }

      const results = await Promise.allSettled([
        roblox(
          "https://games.roblox.com/v1/games?universeIds=" +
          encodeURIComponent(id)
        ),
        roblox(
          "https://games.roblox.com/v1/games/" +
          encodeURIComponent(id) + "/votes"
        ),
        roblox(
          "https://thumbnails.roblox.com/v1/games/icons?universeIds=" +
          encodeURIComponent(id) +
          "&returnPolicy=PlaceHolder&size=512x512&format=Png&isCircular=false"
        )
      ]);

      const detailsResult = results[0];

      if (detailsResult.status !== "fulfilled") {
        const error = detailsResult.reason;
        console.error("Game details request failed:", error.message);

        return sendJSON(res, error.status === 429 ? 503 : 502, {
          error: getErrorMessage(error),
          detail: error.message
        });
      }

      const game = detailsResult.value.data?.[0];

      if (!game) {
        return sendJSON(res, 404, {
          error: "Game not found. Check the experience ID and try again."
        });
      }

      const votes =
        results[1].status === "fulfilled"
          ? results[1].value
          : {};

      const thumbnail =
        results[2].status === "fulfilled"
          ? results[2].value.data?.[0]?.imageUrl || null
          : null;

      if (results[1].status === "rejected") {
        console.error("Votes request failed:", results[1].reason.message);
      }

      if (results[2].status === "rejected") {
        console.error("Thumbnail request failed:", results[2].reason.message);
      }

      const upVotes = votes.upVotes ?? game.totalUpVotes ?? null;
      const downVotes = votes.downVotes ?? game.totalDownVotes ?? null;

      const likeRatio =
        upVotes != null &&
        downVotes != null &&
        upVotes + downVotes > 0
          ? (upVotes / (upVotes + downVotes)) * 100
          : null;

      return sendJSON(res, 200, {
        universeId: game.id,
        placeId: game.rootPlaceId,
        name: game.name,
        description: game.description || "",
        playing: game.playing ?? null,
        visits: game.visits ?? null,
        favoritedCount: game.favoritedCount ?? null,
        maxPlayers: game.maxPlayers ?? null,
        creator: game.creator?.name || "Unknown creator",
        creatorType: game.creator?.type || "",
        created: game.created || null,
        updated: game.updated || null,
        genre: game.genre || null,
        thumbnail,
        upVotes,
        downVotes,
        likeRatio,
        fetchedAt: new Date().toISOString()
      });
    }

    // Get a game's thumbnail
    if (url.pathname === "/api/thumbnail") {
      const id = url.searchParams.get("id") || "";

      if (!/^\d{1,20}$/.test(id)) {
        return sendJSON(res, 400, {
          error: "Invalid experience ID."
        });
      }

      const result = await roblox(
        "https://thumbnails.roblox.com/v1/games/icons?universeIds=" +
        encodeURIComponent(id) +
        "&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false"
      );

      return sendJSON(res, 200, {
        url: result.data?.[0]?.imageUrl || null
      });
    }

    return sendJSON(res, 404, {
      error: "API route not found."
    });
  } catch (error) {
    console.error(
      "API request failed:",
      url.pathname,
      error.message,
      "Status:",
      error.status || "unknown"
    );

    const status =
      error.status === 429 ? 503 :
      error.status === 403 ? 502 : 502;

    return sendJSON(res, status, {
      error: getErrorMessage(error),
      detail: error.message || "Unknown error"
    });
  }
}

const server = http.createServer(async (req, res) => {
  let url;

  try {
    url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch {
    res.writeHead(400);
    return res.end("Bad request");
  }

  if (url.pathname.startsWith("/api/")) {
    return handleAPI(req, res, url);
  }

  let requestedFile;

  try {
    requestedFile = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    return res.end("Bad request");
  }

  const file =
    requestedFile === "/"
      ? "index.html"
      : requestedFile.replace(/^\/+/, "");

  const root = path.resolve(PUBLIC);
  const fullPath = path.resolve(root, file);

  if (
    fullPath !== root &&
    !fullPath.startsWith(root + path.sep)
  ) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(fullPath, (error, content) => {
    if (error) {
      res.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8"
      });
      return res.end("File not found");
    }

    res.writeHead(200, {
      "Content-Type":
        MIME_TYPES[path.extname(fullPath).toLowerCase()] ||
        "application/octet-stream"
    });

    res.end(content);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`RBLX Insights running on port ${PORT}`);
});
