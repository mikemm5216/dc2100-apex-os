const baseUrl =
  process.env.API_TEST_URL || "http://127.0.0.1:3100";

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

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
  console.log("=== 1. HEALTH ===");

  const health = await request("/health");

  assert(
    health.status === 200,
    "Health endpoint should return 200."
  );

  console.log("PASS");


  console.log("\n=== 2. LIST CONTENTS ===");

  const list = await request("/contents");

  assert(
    list.status === 200,
    "GET /contents should return 200."
  );

  assert(
    list.body.count >= 5,
    "Seed contents should exist."
  );

  console.log(`PASS — count: ${list.body.count}`);


  console.log("\n=== 3. CREATE CONTENT ===");

  const create = await request("/contents", {
    method: "POST",
    body: JSON.stringify({
      country_code: "TW",
      vehicle_code: "TTRS",
      title: "Temporary CRUD Test Candidate",
      priority: 3,
      notes: "Created by Task 2.6 automated API test.",
      changed_by: "crud-test"
    })
  });

  assert(
    create.status === 201,
    `POST /contents should return 201, got ${create.status}.`
  );

  const contentId = create.body.data.content_id;

  assert(
    contentId.startsWith("P0-TW-TTRS-"),
    "Generated Content ID has wrong format."
  );

  console.log(`PASS — created ${contentId}`);


  console.log("\n=== 4. GET SINGLE CONTENT ===");

  const single = await request(
    `/contents/${contentId}`
  );

  assert(
    single.status === 200,
    "GET single content should return 200."
  );

  assert(
    single.body.data.status === "DISCOVERED",
    "New content should start as DISCOVERED."
  );

  assert(
    single.body.data.status_history.length === 1,
    "New content should have one history entry."
  );

  console.log("PASS");


  console.log("\n=== 5. UPDATE CONTENT ===");

  const update = await request(
    `/contents/${contentId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        title: "Updated CRUD Test Candidate",
        priority: 2,
        notes: "PATCH endpoint verified."
      })
    }
  );

  assert(
    update.status === 200,
    "PATCH content should return 200."
  );

  assert(
    update.body.data.title ===
      "Updated CRUD Test Candidate",
    "Title was not updated."
  );

  assert(
    update.body.data.priority === 2,
    "Priority was not updated."
  );

  console.log("PASS");


  console.log("\n=== 6. VALID STATUS TRANSITION ===");

  const validTransition = await request(
    `/contents/${contentId}/status`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "ANALYZED",
        changed_by: "crud-test",
        reason: "Automated transition verification",
        metadata: {
          test: true
        }
      })
    }
  );

  assert(
    validTransition.status === 200,
    "Valid status transition should return 200."
  );

  assert(
    validTransition.body.data.status === "ANALYZED",
    "Status should now be ANALYZED."
  );

  assert(
    validTransition.body.data.status_history.length === 2,
    "History should contain two entries."
  );

  console.log("PASS — DISCOVERED → ANALYZED");


  console.log("\n=== 7. INVALID STATUS TRANSITION ===");

  const invalidTransition = await request(
    `/contents/${contentId}/status`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "CEO_APPROVED"
      })
    }
  );

  assert(
    invalidTransition.status === 409,
    "Invalid transition should return 409."
  );

  assert(
    invalidTransition.body.error ===
      "INVALID_STATUS_TRANSITION",
    "Expected INVALID_STATUS_TRANSITION error."
  );

  console.log("PASS — illegal jump blocked");


  console.log("\n=== 8. DELETE CONTENT ===");

  const remove = await request(
    `/contents/${contentId}`,
    {
      method: "DELETE"
    }
  );

  assert(
    remove.status === 200,
    "DELETE should return 200."
  );

  assert(
    remove.body.deleted === true,
    "Delete response should confirm deletion."
  );

  console.log("PASS");


  console.log("\n=== 9. CONFIRM DELETED ===");

  const deletedCheck = await request(
    `/contents/${contentId}`
  );

  assert(
    deletedCheck.status === 404,
    "Deleted content should return 404."
  );

  console.log("PASS");


  console.log("\n================================");
  console.log("TASK 2.6 CRUD API: ALL TESTS PASSED");
  console.log("================================");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
