"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { GroupExpenseService } = require("./src/expense-groups");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT, "data", "state.json");
const DEFAULT_GROUP = {
  id: "coachella",
  name: "Coachella"
};

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const service = loadService();

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (url.pathname === "/health") {
    return sendJson(response, 200, { ok: true });
  }

  if (url.pathname.startsWith("/api/")) {
    return handleApi(request, response, url);
  }

  const requestPath = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(ROOT, requestPath));

  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, {
        "Content-Type": "text/plain; charset=utf-8"
      });
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    const extension = path.extname(filePath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream"
    });
    response.end(contents);
  });
});

function handleApi(request, response, url) {
  const method = request.method || "GET";

  if (method === "GET" && url.pathname === "/api/state") {
    return sendJson(response, 200, {
      group: service.getGroupSnapshot(DEFAULT_GROUP.id)
    });
  }

  const memberCreateMatch = url.pathname.match(/^\/api\/groups\/([^/]+)\/members$/);
  if (method === "POST" && memberCreateMatch) {
    return readJsonBody(request, response, (body) => {
      const snapshot = service.addMember(decodeURIComponent(memberCreateMatch[1]), body);
      persistState();
      return sendJson(response, 201, snapshot);
    });
  }

  const memberDeactivateMatch = url.pathname.match(/^\/api\/groups\/([^/]+)\/members\/([^/]+)\/deactivate$/);
  if (method === "POST" && memberDeactivateMatch) {
    return withApiErrorHandling(response, () => {
      const groupId = decodeURIComponent(memberDeactivateMatch[1]);
      const memberId = decodeURIComponent(memberDeactivateMatch[2]);
      const snapshot = service.removeMember(groupId, memberId);
      persistState();
      return sendJson(response, 200, snapshot);
    });
  }

  const transactionCreateMatch = url.pathname.match(/^\/api\/groups\/([^/]+)\/transactions$/);
  if (method === "POST" && transactionCreateMatch) {
    return readJsonBody(request, response, (body) => {
      const snapshot = service.createTransaction(decodeURIComponent(transactionCreateMatch[1]), body);
      persistState();
      return sendJson(response, 201, snapshot);
    });
  }

  const transactionUpdateMatch = url.pathname.match(/^\/api\/groups\/([^/]+)\/transactions\/([^/]+)$/);
  if (method === "PUT" && transactionUpdateMatch) {
    return readJsonBody(request, response, (body) => {
      const snapshot = service.editTransaction(
        decodeURIComponent(transactionUpdateMatch[1]),
        decodeURIComponent(transactionUpdateMatch[2]),
        body
      );
      persistState();
      return sendJson(response, 200, snapshot);
    });
  }

  const transactionDeleteMatch = url.pathname.match(/^\/api\/groups\/([^/]+)\/transactions\/([^/]+)$/);
  if (method === "DELETE" && transactionDeleteMatch) {
    return withApiErrorHandling(response, () => {
      const snapshot = service.deleteTransaction(
        decodeURIComponent(transactionDeleteMatch[1]),
        decodeURIComponent(transactionDeleteMatch[2])
      );
      persistState();
      return sendJson(response, 200, snapshot);
    });
  }

  return sendJson(response, 404, { error: "Not found." });
}

function readJsonBody(request, response, handler) {
  let rawBody = "";

  request.on("data", (chunk) => {
    rawBody += chunk;
  });

  request.on("end", () => {
    let body;

    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch (error) {
      sendJson(response, 400, { error: "Invalid JSON body." });
      return;
    }

    withApiErrorHandling(response, () => handler(body));
  });

  request.on("error", () => {
    sendJson(response, 500, { error: "Failed to read request body." });
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function withApiErrorHandling(response, handler) {
  try {
    return handler();
  } catch (error) {
    const statusCode = error && /does not exist|required|greater than zero|at least one|duplicate|must be stored/i.test(error.message)
      ? 400
      : 500;

    return sendJson(response, statusCode, {
      error: error && error.message ? error.message : "Server error."
    });
  }
}

function ensureDataDir() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
}

function loadService() {
  ensureDataDir();
  const nextService = new GroupExpenseService();

  if (!fs.existsSync(DATA_FILE)) {
    nextService.createGroup(DEFAULT_GROUP);
    return nextService;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    nextService.groups = parsed.groups || {};
  } catch (error) {
    console.error(`Failed to read ${DATA_FILE}:`, error);
  }

  if (!nextService.groups[DEFAULT_GROUP.id]) {
    nextService.createGroup(DEFAULT_GROUP);
  }

  return nextService;
}

function persistState() {
  ensureDataDir();
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify({ groups: service.groups }, null, 2)
  );
}

server.listen(PORT, () => {
  console.log(`Split Circle is running at http://localhost:${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
});
