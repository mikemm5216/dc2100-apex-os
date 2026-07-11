const baseUrl =
  process.env.API_TEST_URL ||
  "http://127.0.0.1:3100";

const createdIds = [];

async function request(path, options = {}) {
  const response = await fetch(
    `${baseUrl}${path}`,
    {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    }
  );

  const body = await response.json();

  return {
    status: response.status,
    body
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`TEST FAILED: ${message}`);
  }
}

async function getSource(sourceId) {
  return request(
    `/sources/${encodeURIComponent(sourceId)}`
  );
}

async function cleanup() {
  for (const sourceId of createdIds) {
    try {
      await request(
        `/sources/${encodeURIComponent(sourceId)}`,
        {
          method: "DELETE"
        }
      );
    } catch {
      // Best-effort cleanup only.
    }
  }
}

async function run() {
  try {
    console.log("=== 1. CREATE TEMP SOURCES ===");

    const stamp = Date.now();

    for (let index = 1; index <= 3; index += 1) {
      const result = await request("/sources", {
        method: "POST",
        body: JSON.stringify({
          name: `Bulk Source Test ${stamp}-${index}`,
          url:
            `https://example.com/bulk-source-${stamp}-${index}`,
          platform: "YouTube",
          category: "JDM",
          country_code: "JP",
          priority: 3,
          enabled: true
        })
      });

      assert(
        result.status === 201,
        `Source creation failed with ${result.status}.`
      );

      createdIds.push(result.body.data.id);
    }

    console.log("PASS", createdIds);


    console.log("\n=== 2. REJECT INVALID ID ===");

    const invalidId = await request(
      "/sources/bulk",
      {
        method: "PATCH",
        body: JSON.stringify({
          ids: ["not-a-number"],
          action: "disable"
        })
      }
    );

    assert(
      invalidId.status === 400,
      "Invalid Source ID should return 400."
    );

    console.log("PASS");


    console.log("\n=== 3. BULK DISABLE ===");

    const disable = await request(
      "/sources/bulk",
      {
        method: "PATCH",
        body: JSON.stringify({
          ids: createdIds,
          action: "disable"
        })
      }
    );

    assert(
      disable.status === 200,
      `Bulk disable returned ${disable.status}.`
    );

    assert(
      disable.body.data.updated_count === 3,
      "Bulk disable should update 3 sources."
    );

    for (const sourceId of createdIds) {
      const source = await getSource(sourceId);

      assert(
        source.body.data.enabled === false,
        `Source ${sourceId} was not disabled.`
      );
    }

    console.log("PASS");


    console.log("\n=== 4. BULK SET PRIORITY ===");

    const priority = await request(
      "/sources/bulk",
      {
        method: "PATCH",
        body: JSON.stringify({
          ids: createdIds,
          action: "set_priority",
          priority: 1
        })
      }
    );

    assert(
      priority.status === 200,
      `Bulk priority returned ${priority.status}.`
    );

    for (const sourceId of createdIds) {
      const source = await getSource(sourceId);

      assert(
        source.body.data.priority === 1,
        `Source ${sourceId} priority was not updated.`
      );
    }

    console.log("PASS");


    console.log("\n=== 5. BULK ENABLE ===");

    const enable = await request(
      "/sources/bulk",
      {
        method: "PATCH",
        body: JSON.stringify({
          ids: createdIds,
          action: "enable"
        })
      }
    );

    assert(
      enable.status === 200,
      `Bulk enable returned ${enable.status}.`
    );

    for (const sourceId of createdIds) {
      const source = await getSource(sourceId);

      assert(
        source.body.data.enabled === true,
        `Source ${sourceId} was not enabled.`
      );
    }

    console.log("PASS");


    console.log("\n=== 6. BULK DELETE ===");

    const remove = await request(
      "/sources/bulk",
      {
        method: "DELETE",
        body: JSON.stringify({
          ids: createdIds
        })
      }
    );

    assert(
      remove.status === 200,
      `Bulk delete returned ${remove.status}.`
    );

    assert(
      remove.body.data.deleted_count === 3,
      "Bulk delete should delete 3 sources."
    );

    for (const sourceId of createdIds) {
      const source = await getSource(sourceId);

      assert(
        source.status === 404,
        `Deleted Source ${sourceId} still exists.`
      );
    }

    createdIds.length = 0;

    console.log("PASS");

    console.log(
      "\nSOURCE BULK API: ALL TESTS PASSED"
    );
  } finally {
    await cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
