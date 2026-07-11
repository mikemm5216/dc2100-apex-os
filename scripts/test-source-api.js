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
