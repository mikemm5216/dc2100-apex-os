const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function boot() {
  try {
    await pool.query("SELECT 1");

    console.log(JSON.stringify({
      status: "ready",
      service: "apex-worker",
      database: "connected",
      timestamp: new Date().toISOString()
    }));
  } catch (error) {
    console.error("Worker boot failed:", error.message);
    process.exit(1);
  }
}

boot();

setInterval(() => {
  console.log(JSON.stringify({
    status: "heartbeat",
    service: "apex-worker",
    timestamp: new Date().toISOString()
  }));
}, 300000);

async function shutdown(signal) {
  console.log(`Received ${signal}. Shutting down worker.`);
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
