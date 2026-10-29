#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REQUIREMENTS_RELATIVE_PATH = path.join(
  "docs",
  "concepts",
  "REQUIREMENTS.md",
);
const QUESTION_PATTERN = /^\s*\d+\.\s+(.+?)\s*$/;
const ANSWER_PATTERN = /^\s*\*\*ANSWER\*\*\s*$/;
const TBD_PATTERN = /^\s*--TBD--\s*$/;

// Reads every **ANSWER** block and sorts it into pending (only the exact
// --TBD-- placeholder) or answered (any other content, including markers
// such as -IMPLEMENTATION- or -OUT-OF-SCOPE-). An answered block that is
// still in the file has not been folded into the PRD body yet.
export function findAnswerBlocks(contents) {
  const pendingAnswers = [];
  const answeredQuestions = [];
  let currentQuestion = "";
  let currentQuestionLine = null;
  let answerIsNext = false;

  const lines = contents.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const questionMatch = line.match(QUESTION_PATTERN);
    if (questionMatch) {
      currentQuestion = questionMatch[1];
      currentQuestionLine = lineNumber;
      answerIsNext = false;
      continue;
    }

    if (ANSWER_PATTERN.test(line)) {
      answerIsNext = true;
      continue;
    }

    if (!answerIsNext || line.trim() === "") {
      continue;
    }

    const entry = {
      question: currentQuestion,
      question_line: currentQuestionLine,
    };
    if (TBD_PATTERN.test(line)) {
      pendingAnswers.push({ ...entry, placeholder_line: lineNumber });
    } else {
      answeredQuestions.push({ ...entry, answer_line: lineNumber });
    }

    answerIsNext = false;
  }

  return { pendingAnswers, answeredQuestions };
}

export function findPendingAnswers(contents) {
  return findAnswerBlocks(contents).pendingAnswers;
}

export function findAnsweredQuestions(contents) {
  return findAnswerBlocks(contents).answeredQuestions;
}

export function inspectProject(projectRoot) {
  const requirementsPath = path.resolve(projectRoot, REQUIREMENTS_RELATIVE_PATH);
  if (!fs.existsSync(requirementsPath) || !fs.statSync(requirementsPath).isFile()) {
    return {
      requirements_exists: false,
      requirements_path: requirementsPath,
      pending_answer_count: 0,
      pending_answers: [],
      answered_unapplied_count: 0,
      answered_unapplied: [],
      route: "create_or_update_prd",
    };
  }

  const contents = fs.readFileSync(requirementsPath, "utf8");
  const { pendingAnswers, answeredQuestions } = findAnswerBlocks(contents);

  let route = "create_or_update_prd";
  if (pendingAnswers.length > 0) {
    route = "interview_pending_answers";
  } else if (answeredQuestions.length > 0) {
    route = "ready_for_update";
  }

  return {
    requirements_exists: true,
    requirements_path: requirementsPath,
    pending_answer_count: pendingAnswers.length,
    pending_answers: pendingAnswers,
    answered_unapplied_count: answeredQuestions.length,
    answered_unapplied: answeredQuestions,
    route,
  };
}

function main() {
  const projectRoot = path.resolve(process.argv[2] ?? ".");
  console.log(JSON.stringify(inspectProject(projectRoot), null, 2));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main();
}
