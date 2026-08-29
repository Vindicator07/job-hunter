import { MAX_JOB_AGE_DAYS } from "./constants.js";

import { normalizeText } from "./utils.js";

const EXCLUDED_TITLE_PATTERNS = [
  "java developer",
  "java engineer",
  "spring boot developer",
  "spring boot engineer",

  ".net developer",
  ".net engineer",
  "dotnet developer",
  "dotnet engineer",

  "python developer",
  "python engineer",
  "django developer",

  "php developer",
  "php engineer",
  "laravel developer",

  "frontend developer",
  "front end developer",
  "frontend engineer",
  "front end engineer",

  "ui developer",
  "ui engineer",

  "qa engineer",
  "qa developer",
  "test engineer",
  "testing engineer",
  "automation tester",
  "manual tester",

  "devops engineer",
  "devops developer",
  "site reliability engineer",

  "data scientist",
  "data analyst",
  "data engineer",
  "machine learning engineer",
  "ml engineer",

  "android developer",
  "ios developer",
  "flutter developer",
  "react native developer",

  "salesforce developer",
  "sap developer",
  "abap developer",

  "business analyst",
  "technical support",
  "support engineer",

  "agile developer",
  "scrum developer",
  "wordpress developer",
  "shopify developer",
];

function containsAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

/* =========================================================
   TITLE FILTER
========================================================= */

function isTargetTitle(title) {
  const normalized = normalizeText(title);

  if (containsAny(normalized, EXCLUDED_TITLE_PATTERNS)) {
    return false;
  }

  if (normalized.includes("node js") || normalized.includes("nodejs")) {
    return true;
  }

  if (normalized.includes("nestjs") || normalized.includes("nest js")) {
    return true;
  }

  if (
    normalized.includes("backend") ||
    normalized.includes("back end") ||
    normalized.includes("back-end")
  ) {
    return true;
  }

  if (
    normalized.includes("full stack") ||
    normalized.includes("full-stack") ||
    normalized.includes("fullstack")
  ) {
    return true;
  }

  if (
    normalized.includes("software engineer") ||
    normalized.includes("software developer") ||
    normalized.includes("software development engineer") ||
    /\bsde\b/.test(normalized)
  ) {
    return true;
  }

  return false;
}

/* =========================================================
   RELEVANCE
========================================================= */

function isRelevantJob(job) {
  const title = normalizeText(job.title);

  const description = normalizeText(job.description);

  if (!isTargetTitle(title)) {
    return false;
  }

  const combined = `${title} ${description}`;

  const hasNode = containsAny(combined, ["node.js", "nodejs", "node js"]);

  const hasTypeScript = combined.includes("typescript");

  const hasNest = containsAny(combined, ["nestjs", "nest.js", "nest js"]);

  const hasExpress = containsAny(combined, ["express.js", "express js"]);

  const hasRelevantBackendTech =
    hasNode || hasTypeScript || hasNest || hasExpress;

  /*
   * Generic software engineering roles
   * need evidence of relevant backend
   * technology.
   */
  if (
    title.includes("software engineer") ||
    title.includes("software developer") ||
    title.includes("software development engineer") ||
    /\bsde\b/.test(title)
  ) {
    return hasRelevantBackendTech;
  }

  /*
   * Explicit Node.js / NestJS roles.
   */
  if (
    title.includes("nodejs") ||
    title.includes("node js") ||
    title.includes("nestjs") ||
    title.includes("nest js")
  ) {
    return true;
  }

  /*
   * Backend roles.
   */
  if (
    title.includes("backend") ||
    title.includes("back end") ||
    title.includes("back-end")
  ) {
    return hasRelevantBackendTech;
  }

  /*
   * Full-stack roles.
   */
  if (
    title.includes("full stack") ||
    title.includes("full-stack") ||
    title.includes("fullstack")
  ) {
    return hasRelevantBackendTech;
  }

  return false;
}

/* =========================================================
   FRESHNESS
========================================================= */

function isFreshJob(postedAt) {
  if (!postedAt) {
    return false;
  }

  const postedTime = new Date(postedAt).getTime();

  if (Number.isNaN(postedTime)) {
    return false;
  }

  const maxAge = MAX_JOB_AGE_DAYS * 24 * 60 * 60 * 1000;

  const age = Date.now() - postedTime;

  return age >= 0 && age <= maxAge;
}

/* =========================================================
   MAIN FILTER
========================================================= */

export function filterFreshRelevantJobs(jobs) {
  const filtered = [];

  for (const job of jobs) {
    if (!isFreshJob(job.postedAt)) {
      console.log(`📅 Skipped old/invalid job: ${job.title} at ${job.company}`);

      continue;
    }

    console.log(
      `📅 Fresh job: ${job.title} at ${job.company} - Posted ${new Date(
        job.postedAt,
      ).toISOString()}`,
    );

    if (!isRelevantJob(job)) {
      console.log(
        `🚫 Local relevance filter rejected: ${job.title} at ${job.company}`,
      );

      continue;
    }

    console.log(`✅ Passed local filter: ${job.title} at ${job.company}`);

    filtered.push(job);
  }

  return filtered;
}
