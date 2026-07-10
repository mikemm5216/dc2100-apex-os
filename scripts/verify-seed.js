const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function verify() {
  const tables = [
    "countries",
    "vehicles",
    "sources",
    "signals",
    "contents",
    "content_status_history"
  ];

  console.log("SEED COUNTS:");

  for (const table of tables) {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM ${table}`
    );

    console.log(`- ${table}: ${result.rows[0].count}`);
  }

  const contents = await pool.query(`
    SELECT
      content_id,
      title,
      status,
      priority
    FROM contents
    ORDER BY priority, content_id
  `);

  console.log("\nCONTENT CANDIDATES:");

  for (const row of contents.rows) {
    console.log(
      `- ${row.content_id} | ${row.status} | P${row.priority} | ${row.title}`
    );
  }
}

verify()
  .catch((error) => {
    console.error("Seed verification failed:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
