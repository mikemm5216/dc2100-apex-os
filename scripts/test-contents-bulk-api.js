const baseUrl = process.env.API_TEST_URL || "http://127.0.0.1:3100";

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
  console.log("=== 1. CREATE TEMPORARY CONTENTS ===");
  const contentIds = [];
  for (let i = 0; i < 3; i++) {
    const create = await request("/contents", {
      method: "POST",
      body: JSON.stringify({
        country_code: "US",
        vehicle_code: "TEST",
        title: `Bulk Test Content ${i}`,
        priority: 3
      })
    });
    assert(create.status === 201, `Failed to create content, got ${create.status}`);
    contentIds.push(create.body.data.content_id);
  }
  console.log("PASS — created 3 contents");

  console.log("\n=== 2. BULK CHANGE PRIORITY ===");
  const bulkPriority = await request("/contents/bulk", {
    method: "PATCH",
    body: JSON.stringify({
      content_ids: contentIds,
      priority: 1
    })
  });
  assert(bulkPriority.status === 200, `Bulk priority should return 200, got ${bulkPriority.status}`);
  assert(bulkPriority.body.data.updated_count === 3, "Should update 3 contents");
  console.log("PASS");

  console.log("\n=== 3. VALID BULK STATUS TRANSITION ===");
  const validTransition = await request("/contents/bulk/status", {
    method: "PATCH",
    body: JSON.stringify({
      content_ids: contentIds,
      status: "ANALYZED",
      changed_by: "test-script",
      reason: "Bulk validation test"
    })
  });
  assert(validTransition.status === 200, `Valid transition should return 200, got ${validTransition.status}`);
  assert(validTransition.body.data.updated_count === 3, "Should update 3 contents");
  console.log("PASS");

  console.log("\n=== 4. VERIFY STATUS HISTORY ===");
  const check = await request(`/contents/${contentIds[0]}`);
  assert(check.status === 200, "Should get content");
  assert(check.body.data.status === "ANALYZED", "Status should be ANALYZED");
  assert(check.body.data.priority === 1, "Priority should be 1");
  const history = check.body.data.status_history;
  assert(history.length >= 2, "Should have history records");
  const lastHistory = history[history.length - 1];
  assert(lastHistory.to_status === "ANALYZED", "History should record ANALYZED");
  assert(lastHistory.changed_by === "test-script", "History changed_by should match");
  console.log("PASS");

  console.log("\n=== 5. INVALID BULK STATUS ATTEMPT ===");
  // Attempt invalid transition (ANALYZED -> SCHEDULED is invalid)
  const invalidTransition = await request("/contents/bulk/status", {
    method: "PATCH",
    body: JSON.stringify({
      content_ids: contentIds,
      status: "SCHEDULED"
    })
  });
  assert(invalidTransition.status === 409, `Invalid transition should be rejected with 409, got ${invalidTransition.status}`);
  
  // Verify it rolled back
  const checkAfterInvalid = await request(`/contents/${contentIds[0]}`);
  assert(checkAfterInvalid.body.data.status === "ANALYZED", "Status should still be ANALYZED");
  console.log("PASS");

  console.log("\n=== 6. BULK DELETE ===");
  const bulkDelete = await request("/contents/bulk", {
    method: "DELETE",
    body: JSON.stringify({
      content_ids: contentIds
    })
  });
  assert(bulkDelete.status === 200, `Bulk delete should return 200, got ${bulkDelete.status}`);
  assert(bulkDelete.body.data.deleted_count === 3, "Should delete 3 contents");
  console.log("PASS");

  console.log("\n=== 7. CONFIRM DELETED ===");
  const verifyDelete = await request(`/contents/${contentIds[0]}`);
  assert(verifyDelete.status === 404, "Deleted content should return 404");
  console.log("PASS");

  console.log("\n================================");
  console.log("CONTENT BULK API: ALL TESTS PASSED");
  console.log("================================");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
