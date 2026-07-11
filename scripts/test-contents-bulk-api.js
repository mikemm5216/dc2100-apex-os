const baseUrl =
  process.env.API_TEST_URL ||
  "http://127.0.0.1:3100";

const createdContentIds = [];

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

async function getContent(contentId) {
  return request(
    `/contents/${encodeURIComponent(contentId)}`
  );
}

async function cleanup() {
  for (const contentId of createdContentIds) {
    try {
      await request(
        `/contents/${encodeURIComponent(contentId)}`,
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
    console.log(
      "=== 1. CREATE TEMP CONTENT CANDIDATES ==="
    );

    const stamp = Date.now();

    for (let index = 1; index <= 3; index += 1) {
      const contentId =
        `P0-TW-TTRS-${stamp}${index}`;

      const result = await request(
        "/contents",
        {
          method: "POST",
          body: JSON.stringify({
            content_id: contentId,
            country_code: "TW",
            vehicle_code: "TTRS",
            title:
              `Bulk Candidate Test ${stamp}-${index}`,
            priority: 3,
            changed_by: "bulk-test"
          })
        }
      );

      assert(
        result.status === 201,
        `Content creation failed with ${result.status}.`
      );

      createdContentIds.push(contentId);
    }

    console.log("PASS", createdContentIds);


    console.log("\n=== 2. BULK PRIORITY ===");

    const priority = await request(
      "/contents/bulk",
      {
        method: "PATCH",
        body: JSON.stringify({
          content_ids: createdContentIds,
          priority: 1
        })
      }
    );

    assert(
      priority.status === 200,
      `Bulk priority returned ${priority.status}.`
    );

    assert(
      priority.body.data.updated_count === 3,
      "Bulk priority should update 3 candidates."
    );

    for (const contentId of createdContentIds) {
      const content = await getContent(contentId);

      assert(
        content.body.data.priority === 1,
        `${contentId} priority was not updated.`
      );
    }

    console.log("PASS");


    console.log(
      "\n=== 3. VALID BULK STATUS TRANSITION ==="
    );

    const validTransition = await request(
      "/contents/bulk/status",
      {
        method: "PATCH",
        body: JSON.stringify({
          content_ids: createdContentIds,
          status: "ANALYZED",
          changed_by: "bulk-test",
          reason:
            "Task 3.1.1A valid bulk transition",
          metadata: {
            source: "automated-test"
          }
        })
      }
    );

    assert(
      validTransition.status === 200,
      `Valid transition returned ${validTransition.status}.`
    );

    assert(
      validTransition.body.data.updated_count === 3,
      "Valid transition should update 3 candidates."
    );

    for (const contentId of createdContentIds) {
      const content = await getContent(contentId);

      assert(
        content.body.data.status === "ANALYZED",
        `${contentId} was not moved to ANALYZED.`
      );

      const history =
        content.body.data.status_history;

      const lastHistory =
        history[history.length - 1];

      assert(
        lastHistory.from_status === "DISCOVERED",
        `${contentId} history has wrong from_status.`
      );

      assert(
        lastHistory.to_status === "ANALYZED",
        `${contentId} history has wrong to_status.`
      );

      assert(
        lastHistory.changed_by === "bulk-test",
        `${contentId} history has wrong changed_by.`
      );
    }

    console.log("PASS");


    console.log(
      "\n=== 4. PREPARE MIXED STATUS BATCH ==="
    );

    const firstId = createdContentIds[0];
    const secondId = createdContentIds[1];

    const moveFirst = await request(
      `/contents/${encodeURIComponent(firstId)}/status`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "RECOMMENDED",
          changed_by: "bulk-test",
          reason:
            "Prepare mixed-state rollback test"
        })
      }
    );

    assert(
      moveFirst.status === 200,
      "Failed to prepare mixed status batch."
    );

    console.log("PASS");


    console.log(
      "\n=== 5. INVALID BULK TRANSITION ROLLS BACK ==="
    );

    const invalidTransition = await request(
      "/contents/bulk/status",
      {
        method: "PATCH",
        body: JSON.stringify({
          content_ids: [
            firstId,
            secondId
          ],
          status: "CEO_APPROVED",
          changed_by: "bulk-test"
        })
      }
    );

    assert(
      invalidTransition.status === 409,
      `Invalid transition should return 409, got ${invalidTransition.status}.`
    );

    const firstAfter =
      await getContent(firstId);

    const secondAfter =
      await getContent(secondId);

    assert(
      firstAfter.body.data.status ===
        "RECOMMENDED",
      "Valid row was partially updated during rejected batch."
    );

    assert(
      secondAfter.body.data.status ===
        "ANALYZED",
      "Invalid row changed during rejected batch."
    );

    console.log("PASS");


    console.log("\n=== 6. BULK DELETE ===");

    const remove = await request(
      "/contents/bulk",
      {
        method: "DELETE",
        body: JSON.stringify({
          content_ids: createdContentIds
        })
      }
    );

    assert(
      remove.status === 200,
      `Bulk delete returned ${remove.status}.`
    );

    assert(
      remove.body.data.deleted_count === 3,
      "Bulk delete should delete 3 candidates."
    );

    for (const contentId of createdContentIds) {
      const content =
        await getContent(contentId);

      assert(
        content.status === 404,
        `${contentId} still exists after deletion.`
      );
    }

    createdContentIds.length = 0;

    console.log("PASS");

    console.log(
      "\nCONTENT BULK API: ALL TESTS PASSED"
    );
  } finally {
    await cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
