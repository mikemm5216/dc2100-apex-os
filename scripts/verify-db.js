const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function verify() {
  const tables = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);

  console.log("TABLES:");

  for (const row of tables.rows) {
    console.log(`- ${row.table_name}`);
  }

  const migrations = await pool.query(`
    SELECT filename, executed_at
    FROM schema_migrations
    ORDER BY filename
  `);

  console.log("\nMIGRATIONS:");

  for (const row of migrations.rows) {
    console.log(
      `- ${row.filename} @ ${row.executed_at.toISOString()}`
    );
  }
}

verify()
  .catch((error) => {
    console.error("Database verification failed:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
