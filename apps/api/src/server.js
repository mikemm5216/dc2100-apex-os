const http = require("node:http");

const port = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.url === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({
      status: "ok",
      service: "apex-api"
    }));
    return;
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
