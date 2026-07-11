const baseUrl =
  process.env.API_TEST_URL ||
  "http://127.0.0.1:3100";

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

async function run() {
  console.log("=== 1. LIST SOURCES ===");

  const list = await request("/sources");

  assert(
    list.status === 200,
    "GET /sources should return 200."
  );

  assert(
    list.body.count >= 5,
    "Seed sources should exist."
  );

  console.log(`PASS — count: ${list.body.count}`);


  console.log("\n=== 2. CREATE SOURCE ===");

  const uniqueUrl =
    `https://example.com/source-crud-${Date.now()}`;

  const create = await request("/sources", {
    method: "POST",
    body: JSON.stringify({
      name: "Temporary Source CRUD Test",
      url: uniqueUrl,
      platform: "YouTube",
      category: "JDM",
      country_code: "JP",
      priority: 3,
      enabled: true
    })
  });

  assert(
    create.status === 201,
    `POST /sources should return 201, got ${create.status}.`
  );

  const sourceId = create.body.data.id;

  console.log(`PASS — created source ${sourceId}`);


  console.log("\n=== 3. GET SOURCE ===");

  const single = await request(
    `/sources/${sourceId}`
  );

  assert(
    single.status === 200,
    "GET source should return 200."
  );

  assert(
    single.body.data.country_code === "JP",
    "Country should be JP."
  );

  console.log("PASS");


  console.log("\n=== 4. UPDATE SOURCE ===");

  const update = await request(
    `/sources/${sourceId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        name: "Updated Source CRUD Test",
        priority: 1
      })
    }
  );

  assert(
    update.status === 200,
    "PATCH source should return 200."
  );

  assert(
    update.body.data.name ===
      "Updated Source CRUD Test",
    "Source name was not updated."
  );

  assert(
    update.body.data.priority === 1,
    "Source priority was not updated."
  );

  console.log("PASS");


  console.log("\n=== 5. DISABLE SOURCE ===");

  const disable = await request(
    `/sources/${sourceId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        enabled: false
      })
    }
  );

  assert(
    disable.status === 200,
    "Disable source should return 200."
  );

  assert(
    disable.body.data.enabled === false,
    "Source should be disabled."
  );

  console.log("PASS");


  console.log("\n=== 6. DELETE SOURCE ===");

  const remove = await request(
    `/sources/${sourceId}`,
    {
      method: "DELETE"
    }
  );

  assert(
    remove.status === 200,
    "DELETE source should return 200."
  );

  assert(
    remove.body.deleted === true,
    "Delete response should confirm deletion."
  );

  console.log("PASS");


  console.log("\n=== 7. CONFIRM DELETED ===");

  const deletedCheck = await request(
    `/sources/${sourceId}`
  );

  assert(
    deletedCheck.status === 404,
    "Deleted source should return 404."
  );

  console.log("PASS");


  console.log("\n=== 8. CREATE BULK SOURCES ===");
  const bulkSources = [];
  for (let i = 0; i < 3; i++) {
    const res = await request("/sources", {
      method: "POST",
      body: JSON.stringify({
        name: `Bulk Test Source ${i}`,
        url: `https://example.com/bulk-${Date.now()}-${i}`,
        platform: "YouTube",
        category: "JDM",
        priority: 3,
        enabled: true
      })
    });
    assert(res.status === 201, "Should create bulk source.");
    bulkSources.push(res.body.data.id);
  }
  console.log("PASS");

  console.log("\n=== 9. BULK DISABLE ===");
  const bulkDisable = await request("/sources/bulk", {
    method: "PATCH",
    body: JSON.stringify({
      ids: bulkSources,
      action: "disable"
    })
  });
  assert(bulkDisable.status === 200, "Bulk disable should return 200.");
  assert(bulkDisable.body.data.updated_count === 3, "Should update 3 sources.");
  console.log("PASS");

  console.log("\n=== 10. BULK ENABLE ===");
  const bulkEnable = await request("/sources/bulk", {
    method: "PATCH",
    body: JSON.stringify({
      ids: bulkSources,
      action: "enable"
    })
  });
  assert(bulkEnable.status === 200, "Bulk enable should return 200.");
  assert(bulkEnable.body.data.updated_count === 3, "Should update 3 sources.");
  console.log("PASS");

  console.log("\n=== 11. BULK SET PRIORITY ===");
  const bulkPriority = await request("/sources/bulk", {
    method: "PATCH",
    body: JSON.stringify({
      ids: bulkSources,
      action: "set_priority",
      priority: 1
    })
  });
  assert(bulkPriority.status === 200, "Bulk set priority should return 200.");
  assert(bulkPriority.body.data.updated_count === 3, "Should update 3 sources.");
  console.log("PASS");

  console.log("\n=== 12. BULK DELETE ===");
  const bulkDelete = await request("/sources/bulk", {
    method: "DELETE",
    body: JSON.stringify({
      ids: bulkSources
    })
  });
  assert(bulkDelete.status === 200, "Bulk delete should return 200.");
  assert(bulkDelete.body.data.deleted_count === 3, "Should delete 3 sources.");
  console.log("PASS");



  console.log("\n================================");
  console.log(
    "TASK 3.1 SOURCE API: ALL TESTS PASSED"
  );
  console.log("================================");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
