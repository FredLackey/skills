#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  findAnsweredQuestions,
  findPendingAnswers,
  inspectProject,
} from "./inspect_requirements.mjs";

test("finds each unanswered answer block", () => {
  const contents = `# Product Requirements

## 7. Open questions

1. **Authentication:** Which provider should the app use?

    **ANSWER**
    --TBD--

2. **Hosting:** Where should the app run?

    **ANSWER**
    AWS Lambda

3. **Retention:** How long should data be retained?

    **ANSWER**
    --TBD--
`;

  const pendingAnswers = findPendingAnswers(contents);

  assert.equal(pendingAnswers.length, 2);
  assert.equal(
    pendingAnswers[0].question,
    "**Authentication:** Which provider should the app use?",
  );
  assert.equal(pendingAnswers[0].placeholder_line, 8);
  assert.equal(
    pendingAnswers[1].question,
    "**Retention:** How long should data be retained?",
  );
});

test("ignores TBD text outside an answer block", () => {
  const contents = `# Product Requirements

Status note: --TBD--

1. **Resolved question:** What was decided?

    **ANSWER**
    Use the existing service.
`;

  assert.deepEqual(findPendingAnswers(contents), []);
});

test("routes missing requirements to creation", () => {
  withTemporaryDirectory((projectRoot) => {
    const result = inspectProject(projectRoot);

    assert.equal(result.requirements_exists, false);
    assert.equal(result.route, "create_or_update_prd");
    assert.equal(result.pending_answer_count, 0);
  });
});

test("routes pending answers to interview", () => {
  withTemporaryDirectory((projectRoot) => {
    writeRequirements(
      projectRoot,
      `## 7. Open questions

1. **Database:** Which database should be used?

    **ANSWER**
    --TBD--
`,
    );

    const result = inspectProject(projectRoot);

    assert.equal(result.requirements_exists, true);
    assert.equal(result.route, "interview_pending_answers");
    assert.equal(result.pending_answer_count, 1);
  });
});

test("routes answered but unapplied questions to the update question", () => {
  withTemporaryDirectory((projectRoot) => {
    writeRequirements(
      projectRoot,
      `## 7. Open questions

1. **Database:** Which database should be used?

    **ANSWER**
    PostgreSQL

2. **Cool-off length:** How long is the cool-off?

    **ANSWER**
    -IMPLEMENTATION-
`,
    );

    const result = inspectProject(projectRoot);

    assert.equal(result.requirements_exists, true);
    assert.equal(result.route, "ready_for_update");
    assert.equal(result.pending_answer_count, 0);
    assert.equal(result.answered_unapplied_count, 2);
    assert.equal(result.answered_unapplied[0].answer_line, 6);
  });
});

test("pending answers take priority over answered ones", () => {
  withTemporaryDirectory((projectRoot) => {
    writeRequirements(
      projectRoot,
      `## 7. Open questions

1. **Database:** Which database should be used?

    **ANSWER**
    PostgreSQL

2. **Retention:** How long should data be retained?

    **ANSWER**
    --TBD--
`,
    );

    const result = inspectProject(projectRoot);

    assert.equal(result.route, "interview_pending_answers");
    assert.equal(result.pending_answer_count, 1);
    assert.equal(result.answered_unapplied_count, 1);
  });
});

test("routes requirements with no open questions to normal workflow", () => {
  withTemporaryDirectory((projectRoot) => {
    writeRequirements(
      projectRoot,
      `## 7. Open questions

None.

## 8. Assumptions

1. The UI and API run in one stack.
`,
    );

    const result = inspectProject(projectRoot);

    assert.equal(result.requirements_exists, true);
    assert.equal(result.route, "create_or_update_prd");
    assert.equal(result.pending_answer_count, 0);
    assert.equal(result.answered_unapplied_count, 0);
  });
});

test("finds answered questions", () => {
  const contents = `1. **Hosting:** Where should the app run?

    **ANSWER**
    AWS Lambda
`;

  assert.deepEqual(findAnsweredQuestions(contents), [
    {
      question: "**Hosting:** Where should the app run?",
      question_line: 1,
      answer_line: 4,
    },
  ]);
});

function withTemporaryDirectory(callback) {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "braindump-to-prd-test-"),
  );

  try {
    callback(temporaryDirectory);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function writeRequirements(projectRoot, contents) {
  const requirementsPath = path.join(
    projectRoot,
    "docs",
    "concepts",
    "REQUIREMENTS.md",
  );
  fs.mkdirSync(path.dirname(requirementsPath), { recursive: true });
  fs.writeFileSync(requirementsPath, contents, "utf8");
}
