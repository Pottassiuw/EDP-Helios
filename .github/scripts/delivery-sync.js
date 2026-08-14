"use strict";

const CLOSING_KEYWORD = /(?:^|[\s(])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;

function extractClosingIssueNumbers(body) {
  const numbers = new Set();

  for (const match of String(body ?? "").matchAll(CLOSING_KEYWORD)) {
    numbers.add(Number(match[1]));
  }

  return [...numbers];
}

function findDoneStatusOption(fields) {
  const statusField = fields.find(
    (field) => field.name === "Status" && Array.isArray(field.options),
  );
  const doneOption = statusField?.options.find((option) => option.name === "Done");

  if (!statusField || !doneOption) {
    throw new Error("Project must expose a Status single-select field with a Done option.");
  }

  return {
    fieldId: statusField.id,
    optionId: doneOption.id,
  };
}

function isMergedIntoDevelop(pullRequest) {
  return (
    pullRequest?.base?.ref === "develop" &&
    Boolean(pullRequest.merged_at ?? pullRequest.mergedAt)
  );
}

module.exports = {
  extractClosingIssueNumbers,
  findDoneStatusOption,
  isMergedIntoDevelop,
};
