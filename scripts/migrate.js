const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const migrationsDir = path.join(
  __dirname,
  "..",
  "db",
  "migrations"
);

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getExecutedMigrations(client) {
  const result = await client.query(`
    SELECT filename
    FROM schema_migrations
    ORDER BY filename
  `);

  return new Set(result.rows.map((row) => row.filename));
}

async function runMigration(client, filename) {
  const filePath = path.join(migrationsDir, filename);
  const sql = fs.readFileSync(filePath, "utf8");

  console.log(`Running migration: ${filename}`);

  try {
    await client.query("BEGIN");

    await client.query(sql);

    await client.query(
      `
        INSERT INTO schema_migrations (filename)
        VALUES ($1)
      `,
      [filename]
    );

    await client.query("COMMIT");

    console.log(`Completed migration: ${filename}`);
  } catch (error) {
    await client.query("ROLLBACK");

    console.error(`Migration failed: ${filename}`);
    throw error;
  }
}

async function migrate() {
  const client = await pool.connect();

  try {
    await ensureMigrationTable(client);

    const executed = await getExecutedMigrations(client);

    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    const pending = migrationFiles.filter(
      (file) => !executed.has(file)
    );

    if (pending.length === 0) {
      console.log("No pending migrations.");
      return;
    }

    console.log(`Pending migrations: ${pending.length}`);

    for (const filename of pending) {
      await runMigration(client, filename);
    }

    console.log("All migrations completed successfully.");
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error(error);
  process.exit(1);
});
