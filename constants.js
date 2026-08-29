/*
 * Maximum age of a job that we accept.
 *
 * 7 means:
 *
 * today
 * ↓
 * maximum 7 days old
 */
export const MAX_JOB_AGE_DAYS = 7;

/*
 * Maximum number of jobs retrieved
 * from each LinkedIn search.
 */
export const JOBS_PER_SEARCH = 5;

/*
 * Maximum number of jobs sent to Gemini
 * in one pipeline run.
 *
 * This protects the Gemini quota.
 */
export const MAX_AI_BATCH_SIZE = 5;

/*
 * Maximum number of pending jobs we load
 * from MongoDB during one run.
 */
export const MAX_PENDING_JOBS_TO_LOAD = 30;

/*
 * Apify actor responsible for scraping
 * LinkedIn jobs.
 */
export const APIFY_ACTOR = "curious_coder/linkedin-jobs-scraper";

/*
 * LinkedIn searches.
 */
export const LINKEDIN_SEARCHES = [
  "Node.js Developer",

  "Senior Node.js Developer",

  "Backend Engineer Node.js",

  "Node.js TypeScript",

  "NestJS Developer",

  "Software Engineer Node.js",

  "Full Stack Engineer Node.js",

  "Backend Developer Node.js",
];
