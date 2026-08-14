"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  extractClosingIssueNumbers,
  findDoneStatusOption,
  isMergedIntoDevelop,
} = require("./delivery-sync");

assert.deepEqual(
  extractClosingIssueNumbers("Closes #17\nFixes #31\nCloses #17\nResolves #34"),
  [17, 31, 34],
);
assert.deepEqual(extractClosingIssueNumbers("References #17 only"), []);
assert.deepEqual(
  findDoneStatusOption([
    { id: "status-field", name: "Status", options: [{ id: "done", name: "Done" }] },
  ]),
  { fieldId: "status-field", optionId: "done" },
);
assert.throws(
  () => findDoneStatusOption([{ id: "status-field", name: "Status", options: [] }]),
  /Done option/,
);
assert.equal(
  isMergedIntoDevelop({ base: { ref: "develop" }, merged_at: "2026-08-14T00:01:05Z" }),
  true,
);
assert.equal(
  isMergedIntoDevelop({ base: { ref: "main" }, merged_at: "2026-08-14T00:01:05Z" }),
  false,
);

const workflow = fs.readFileSync(
  path.join(__dirname, "..", "workflows", "delivery-sync.yml"),
  "utf8",
);
const branchWorkflow = fs.readFileSync(
  path.join(__dirname, "..", "workflows", "update-delivery-branches.yml"),
  "utf8",
);
assert.match(workflow, /types:\s*\n\s+- closed/);
assert.match(workflow, /PROJECT_TOKEN_CONFIGURED/);
assert.match(workflow, /addProjectV2ItemById/);
assert.match(workflow, /updateProjectV2ItemFieldValue/);
assert.match(workflow, /state: "closed"/);
assert.match(branchWorkflow, /contents: write/);
assert.match(branchWorkflow, /headRepository\.nameWithOwner/);
assert.match(branchWorkflow, /gh pr update-branch/);

console.log("delivery-sync contract: passed");
