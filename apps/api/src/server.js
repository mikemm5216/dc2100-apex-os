const http = require("node:http");
const { Pool } = require("pg");

const port = process.env.PORT || 3000;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.url === "/health") {
    res.writeHead(200);
    return res.end(JSON.stringify({
      status: "ok",
      service: "apex-api"
    }));
  }

  if (req.url === "/health/db") {
    try {
      await pool.query("SELECT 1");
      res.writeHead(200);
      return res.end(JSON.stringify({
        status: "ok",
        database: "connected"
      }));
    } catch (error) {
      console.error("Database health check failed:", error.message);
      res.writeHead(500);
      return res.end(JSON.stringify({
        status: "error",
        database: "disconnected"
      }));
    }
  }

  res.writeHead(200);
  res.end(JSON.stringify({
    name: "DC 2100 APEX API",
    status: "running"
  }));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`APEX API listening on port ${port}`);
});
