import { ApifyClient } from "apify-client";

import { config } from "./config.js";

import {
  APIFY_ACTOR,
  JOBS_PER_SEARCH,
  LINKEDIN_SEARCHES,
} from "./constants.js";

import { createDedupeKey } from "./utils.js";

const apify = new ApifyClient({
  token: config.apifyToken,
});

/* =========================================================
   GET POSTED DATE
========================================================= */

function getPostedDate(rawJob) {
  const value =
    rawJob.postedAt ||
    rawJob.postedAtTimestamp ||
    rawJob.datePosted ||
    rawJob.publishedAt ||
    null;

  if (!value) {
    return null;
  }

  if (typeof value === "number") {
    const timestamp = value < 10000000000 ? value * 1000 : value;

    const date = new Date(timestamp);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

/* =========================================================
   NORMALIZE APIFY JOB
========================================================= */

function normalizeJob(rawJob) {
  const id =
    rawJob.id || rawJob.jobId || rawJob.jobUrl || rawJob.link || rawJob.url;

  const title =
    rawJob.title ||
    rawJob.positionName ||
    rawJob.jobTitle ||
    "Software Engineer";

  const company = rawJob.companyName || rawJob.company || "Company";

  const url = rawJob.jobUrl || rawJob.link || rawJob.url || rawJob.applyUrl;

  const description =
    rawJob.description ||
    rawJob.descriptionText ||
    rawJob.jobDescription ||
    rawJob.text ||
    "";

  const location = rawJob.location || "";

  const postedAt = getPostedDate(rawJob);

  return {
    id: id || url,

    title,

    company,

    url,

    description,

    location,

    postedAt,
  };
}

/* =========================================================
   SCRAPE ONE SEARCH
========================================================= */

async function scrapeSearch(searchTerm) {
  const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(
    searchTerm,
  )}&location=India&f_TPR=r604800`;

  console.log(`\n🔍 Searching LinkedIn: "${searchTerm}"`);

  try {
    const run = await apify.actor(APIFY_ACTOR).call({
      urls: [searchUrl],

      count: JOBS_PER_SEARCH,
    });

    const { items } = await apify.dataset(run.defaultDatasetId).listItems();

    console.log(`📥 "${searchTerm}" → ${items.length} jobs`);

    return items.map(normalizeJob).filter((job) => job.id && job.url);
  } catch (error) {
    console.error(
      `❌ Apify search failed for "${searchTerm}":`,
      error?.message || error,
    );

    return [];
  }
}

/* =========================================================
   DEDUPLICATE CURRENT RUN
========================================================= */

function deduplicateJobs(jobs) {
  const seenIds = new Set();

  const seenKeys = new Set();

  const unique = [];

  for (const job of jobs) {
    if (seenIds.has(job.id)) {
      continue;
    }

    const key = createDedupeKey(job.title, job.company);

    if (seenKeys.has(key)) {
      continue;
    }

    seenIds.add(job.id);

    seenKeys.add(key);

    unique.push(job);
  }

  return unique;
}

/* =========================================================
   SCRAPE ALL SEARCHES
========================================================= */

export async function scrapeAllJobSearches() {
  const allJobs = [];

  for (const searchTerm of LINKEDIN_SEARCHES) {
    const jobs = await scrapeSearch(searchTerm);

    allJobs.push(...jobs);
  }

  const uniqueJobs = deduplicateJobs(allJobs);

  console.log(
    `🧹 ${uniqueJobs.length} unique jobs after current-run deduplication.`,
  );

  return uniqueJobs;
}
