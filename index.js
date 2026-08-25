import { ApifyClient } from "apify-client";
import mongoose from "mongoose";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

/* =========================================================
   CONFIG
========================================================= */

const MAX_JOB_AGE_DAYS = 7;

// Number of jobs requested from each LinkedIn search.
const JOBS_PER_SEARCH = 5;

// IMPORTANT:
// Reduced from 10 → 5 to reduce Gemini quota pressure.
const MAX_AI_BATCH_SIZE = 5;

// Maximum pending jobs considered in one run.
const MAX_PENDING_JOBS_TO_LOAD = 30;

// Slack notification threshold.
const SLACK_SCORE_THRESHOLD = 7;

/*
 * Targeted searches.
 */
const LINKEDIN_SEARCHES = [
  "Node.js Developer",
  "Senior Node.js Developer",
  "Backend Engineer Node.js",
  "Node.js TypeScript",
  "NestJS Developer",
  "Software Engineer Node.js",
  "Full Stack Engineer Node.js",
  "Backend Developer Node.js",
];

/* =========================================================
   CLIENTS
========================================================= */

const apify = new ApifyClient({
  token: process.env.APIFY_TOKEN,
});

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

/* =========================================================
   RESUME
========================================================= */

const CANDIDATE_RESUME = `
MAYANK MISHRA

Senior Software Engineer | Node.js, TypeScript, React.js, Nest.JS, Express.js, MongoDB, PostgreSQL, AWS

Email: mishramayank665@gmail.com | Phone: +91-9793870847 | GitHub: Vindicator07

PROFESSIONAL SUMMARY

Senior Software Engineer with 4+ years of experience building scalable backend and full-stack applications, specializing in Node.js, TypeScript, distributed systems, and API-driven architectures.

Experienced in designing multi-tenant, real-time, and production-scale systems, with expertise in secure authentication, third-party integrations, database optimization, system design, and cloud deployments.

TECHNICAL SKILLS

Languages:
JavaScript, TypeScript, SQL

Frontend:
React.js, Angular, Redux

Backend & APIs:
Node.js, Nest.JS, Express.js, REST, GraphQL, Strapi

Databases:
PostgreSQL, MongoDB, Redis

Integrations & Real-Time:
Paystack, Webhooks, Zoom Video SDK, Socket.IO, Server-Sent Events, Firebase Cloud Messaging

Cloud, DevOps & Tools:
AWS (EC2, S3, Lambda), Docker, Git, GitHub, Kafka, Postman, Swagger

Architecture & System Design:
System Design, Microservices, Multi-Tenancy, Event-Driven Architecture, Scalability, Distributed Systems, Asynchronous Programming

WORK EXPERIENCE

Senior Software Engineer | iSon Xperiences

Jan 2026 - Present | Noida, India

Designed and engineered the backend architecture of a multi-country, multi-tenant telemedicine platform using Node.js, TypeScript, Express.js, and MongoDB.

Designed appointment and teleconsultation workflows including availability, slot management, booking, rescheduling, cancellations, family-member appointments, consent, feedback, and automated no-show handling.

Integrated Zoom Video SDK and engineered real-time communication using Socket.IO and Server-Sent Events.

Designed production-grade authentication and authorization using JWT access/refresh tokens, RBAC, OTP, token revocation, device-bound sessions, bcrypt, and biometric public-key verification.

Integrated Paystack subscription-based payments with HMAC-verified, idempotent webhooks.

Integrated Firebase Cloud Messaging, Strapi, AWS S3-compatible storage, and Puppeteer.

Digital Specialist Engineer | Infosys

Aug 2022 - Dec 2025 | Noida, India

Developed and optimized scalable backend services using Node.js, NestJS, and PostgreSQL.

Designed and integrated REST and GraphQL APIs with Angular and React applications.

Implemented JWT authentication and RBAC and supported AWS-based deployments using EC2, S3, and Docker.

Refactored legacy monolithic modules into microservices and optimized database access patterns.

EDUCATION

Bachelor of Technology in Information Technology
2018–2022
`;

/* =========================================================
   MONGODB SCHEMA
========================================================= */

const jobSchema = new mongoose.Schema(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    title: {
      type: String,
      required: true,
    },

    company: {
      type: String,
      required: true,
    },

    url: String,

    description: String,

    location: String,

    postedAt: {
      type: Date,
      index: true,
    },

    /*
     * Used for duplicate detection even when
     * LinkedIn gives different job IDs.
     */
    dedupeKey: {
      type: String,
      index: true,
    },

    score: Number,

    analysis: String,

    missingSkills: {
      type: [String],
      default: [],
    },

    /*
     * AI lifecycle.
     */
    aiStatus: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
      index: true,
    },

    aiAttempts: {
      type: Number,
      default: 0,
    },

    aiProcessedAt: Date,

    aiError: String,

    /*
     * Slack lifecycle.
     */
    slackNotified: {
      type: Boolean,
      default: false,
    },

    slackNotifiedAt: Date,

    /*
     * Application lifecycle.
     */
    applied: {
      type: Boolean,
      default: false,
      index: true,
    },

    appliedAt: Date,

    processedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

const Job = mongoose.model("Job", jobSchema);

/* =========================================================
   NORMALIZATION
========================================================= */

function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompany(company = "") {
  return normalizeText(company)
    .replace(/\b(private|pvt|limited|ltd|inc|llc|corp|corporation)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeJobTitle(title = "") {
  let normalized = normalizeText(title);

  normalized = normalized
    .replace(
      /\b(junior|jr|senior|sr|lead|staff|principal|associate|ii|iii|iv)\b/g,
      " ",
    )
    .replace(/\b(node js|nodejs)\b/g, "nodejs")
    .replace(/\b(nest js|nestjs)\b/g, "nestjs")
    .replace(/\b(full stack|fullstack)\b/g, "fullstack")
    .replace(/\b(back end|back-end)\b/g, "backend");

  return normalized.replace(/\s+/g, " ").trim();
}

function createDedupeKey(title, company) {
  return `${normalizeCompany(company)}::${normalizeJobTitle(title)}`;
}

function isStrongDedupeTitle(title) {
  const text = normalizeJobTitle(title);

  return (
    text.includes("nodejs") ||
    text.includes("backend") ||
    text.includes("fullstack") ||
    text.includes("software engineer") ||
    text.includes("software developer") ||
    text.includes("software development engineer") ||
    text.includes("sde")
  );
}

/* =========================================================
   RELEVANCE FILTER
========================================================= */

/*
 * These are explicitly NOT target roles.
 */
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
  "sre engineer",

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

  /*
   * Important:
   * Prevent generic developer roles such as:
   * Agile Developer.
   */
  "agile developer",
  "scrum developer",
  "wordpress developer",
  "shopify developer",
];

function containsAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

/*
 * Determine whether the TITLE itself is a target role.
 *
 * This is intentionally strict.
 */
function isTargetTitle(title) {
  const normalized = normalizeText(title);

  /*
   * Reject obvious unrelated roles first.
   */
  if (containsAny(normalized, EXCLUDED_TITLE_PATTERNS)) {
    return false;
  }

  /*
   * Explicit Node.js role.
   */
  if (normalized.includes("node js") || normalized.includes("nodejs")) {
    return true;
  }

  /*
   * Explicit NestJS role.
   */
  if (normalized.includes("nestjs") || normalized.includes("nest js")) {
    return true;
  }

  /*
   * Backend role.
   */
  if (
    normalized.includes("backend") ||
    normalized.includes("back end") ||
    normalized.includes("back-end")
  ) {
    return true;
  }

  /*
   * Full-stack role.
   */
  if (
    normalized.includes("full stack") ||
    normalized.includes("full-stack") ||
    normalized.includes("fullstack")
  ) {
    return true;
  }

  /*
   * Software Engineer / SDE.
   *
   * Generic Software Engineer is allowed because
   * Gemini will perform the deeper matching.
   */
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

function isRelevantJob(job) {
  const title = normalizeText(job.title);

  const description = normalizeText(job.description);

  /*
   * FIRST FILTER:
   * Job title must be a target role.
   */
  if (!isTargetTitle(title)) {
    return false;
  }

  /*
   * SECOND FILTER:
   *
   * For Node/backend/full-stack roles,
   * require evidence of relevant backend technology
   * somewhere in the job.
   */
  const hasNode = containsAny(`${title} ${description}`, [
    "node.js",
    "nodejs",
    "node js",
  ]);

  const hasTypeScript = containsAny(`${title} ${description}`, ["typescript"]);

  const hasNest = containsAny(`${title} ${description}`, [
    "nestjs",
    "nest.js",
    "nest js",
  ]);

  const hasExpress = containsAny(`${title} ${description}`, [
    "express.js",
    "express js",
  ]);

  const hasRelevantBackendTech =
    hasNode || hasTypeScript || hasNest || hasExpress;

  /*
   * Generic Software Engineer title:
   *
   * Require relevant backend evidence.
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
   * Node/Nest explicit title.
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
   * Backend title.
   *
   * Require backend technology evidence.
   */
  if (
    title.includes("backend") ||
    title.includes("back end") ||
    title.includes("back-end")
  ) {
    return hasRelevantBackendTech;
  }

  /*
   * Full-stack title.
   *
   * Node.js/TypeScript/NestJS/Express evidence required.
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
   DATE HELPERS
========================================================= */

function getPostedDate(rawJob) {
  const postedAt =
    rawJob.postedAt ||
    rawJob.postedAtTimestamp ||
    rawJob.datePosted ||
    rawJob.publishedAt ||
    null;

  if (!postedAt) {
    return null;
  }

  if (typeof postedAt === "number") {
    const timestamp = postedAt < 10000000000 ? postedAt * 1000 : postedAt;

    const date = new Date(timestamp);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(postedAt);

  return Number.isNaN(date.getTime()) ? null : date;
}

function getSevenDaysAgo() {
  return new Date(Date.now() - MAX_JOB_AGE_DAYS * 24 * 60 * 60 * 1000);
}

function isWithinLastSevenDays(postedAt) {
  return postedAt && postedAt >= getSevenDaysAgo();
}

/* =========================================================
   PENDING QUEUE
========================================================= */

async function getPendingJobs() {
  const jobs = await Job.find({
    aiStatus: {
      $in: ["pending", "failed"],
    },

    postedAt: {
      $gte: getSevenDaysAgo(),
    },
  })
    .sort({
      postedAt: 1,
    })
    .limit(MAX_PENDING_JOBS_TO_LOAD)
    .lean();

  return jobs.map((job) => ({
    id: job.jobId,

    mongoId: job._id,

    title: job.title,

    company: job.company,

    url: job.url,

    description: job.description || "",

    location: job.location || "",

    postedAt: job.postedAt,

    dedupeKey: job.dedupeKey,
  }));
}

/* =========================================================
   GEMINI
========================================================= */

async function scoreJobsWithAI(jobs, resumeText) {
  if (!jobs.length) {
    return {
      status: "empty",
      results: [],
    };
  }

  console.log(`🤖 Sending ${jobs.length} jobs to Gemini in ONE request...`);

  const jobsForAI = jobs.map((job, index) => ({
    index,

    title: job.title,

    company: job.company,

    location: job.location,

    postedAt: job.postedAt ? new Date(job.postedAt).toISOString() : null,

    description: job.description,
  }));

  const prompt = `
You are an expert technical recruiter evaluating jobs for one candidate.

CANDIDATE:

${resumeText}

JOB LIST:

${JSON.stringify(jobsForAI)}

SCORING RULES:

10 = Exceptional match
9 = Excellent match
8 = Very strong match
7 = Strong match and worth applying
6 = Moderate match
5 = Partial match
4 or below = Weak match

Evaluate:

1. Backend engineering responsibilities
2. Node.js
3. TypeScript
4. NestJS / Express
5. REST / GraphQL APIs
6. MongoDB / PostgreSQL / Redis
7. AWS / cloud
8. Microservices
9. Distributed systems
10. System design
11. Authentication / authorization
12. Event-driven architecture
13. Candidate seniority
14. Required years of experience
15. Required technologies

IMPORTANT:

- Do NOT inflate scores.
- Do NOT give 8+ merely because Node.js appears once.
- Mandatory missing skills should reduce the score.
- Optional skills should have a smaller effect.
- Java-only roles should score low.
- Python-only roles should score low.
- .NET-only roles should score low.
- QA/testing roles should score low.
- DevOps-only roles should score low.
- Data-science roles should score low.
- Frontend-only roles should score low.
- Generic software engineering roles should only score highly if their responsibilities align strongly with the resume.
- Prefer backend/full-stack roles involving Node.js and TypeScript.

Return ONLY valid JSON:

{
  "results": [
    {
      "index": 0,
      "shortlist_score": 8,
      "match_analysis": "Sentence one. Sentence two.",
      "missing_skills": ["skill1", "skill2"]
    }
  ]
}
`;

  try {
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-3.6-flash",

      contents: prompt,

      config: {
        responseMimeType: "application/json",
      },
    });

    if (!response.text) {
      return {
        status: "failed",
        results: [],
      };
    }

    const parsed = JSON.parse(response.text);

    if (!parsed || !Array.isArray(parsed.results)) {
      return {
        status: "failed",
        results: [],
      };
    }

    const validResults = parsed.results.filter(
      (result) =>
        Number.isInteger(result.index) &&
        result.index >= 0 &&
        result.index < jobs.length &&
        typeof result.shortlist_score === "number" &&
        result.shortlist_score >= 1 &&
        result.shortlist_score <= 10 &&
        typeof result.match_analysis === "string",
    );

    return {
      status: "success",
      results: validResults,
    };
  } catch (error) {
    const status = error?.status;

    const message = String(error?.message || error || "").toLowerCase();

    const isQuotaError =
      status === 429 ||
      message.includes("quota") ||
      message.includes("rate limit") ||
      message.includes("resource exhausted") ||
      message.includes("too many requests");

    if (isQuotaError) {
      console.error("❌ Gemini quota/rate limit reached.");

      return {
        status: "quota",
        results: [],
      };
    }

    console.error("❌ Gemini evaluation failed:", error?.message || error);

    return {
      status: "failed",
      results: [],
    };
  }
}

/* =========================================================
   SLACK
========================================================= */

async function sendNotification(jobData, aiResult) {
  const payload = {
    text: `🚨 *New High-Scoring Job Match!* (Score: ${aiResult.shortlist_score}/10)

*Title:* ${jobData.title}

*Company:* ${jobData.company}

*Location:* ${jobData.location || "Not specified"}

*Posted:* ${
      jobData.postedAt
        ? new Date(jobData.postedAt).toLocaleString("en-IN")
        : "Unknown"
    }

*Why it's a match:*
${aiResult.match_analysis}

*Missing skills:*
${
  aiResult.missing_skills?.length
    ? aiResult.missing_skills.join(", ")
    : "None identified"
}

*Apply here:*
${jobData.url}`,
  };

  try {
    const response = await fetch(process.env.WEBHOOK_URL, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify(payload),
    });

    const responseText = await response.text();

    console.log("Slack status:", response.status);

    console.log("Slack response:", responseText);

    if (!response.ok) {
      return false;
    }

    console.log(`✅ Slack notification sent for ${jobData.title}`);

    return true;
  } catch (error) {
    console.error("❌ Slack webhook failed:", error?.message || error);

    return false;
  }
}

/* =========================================================
   MARK PROCESSING
========================================================= */

async function markJobsAsProcessing(jobs) {
  const ids = jobs.map((job) => job.mongoId).filter(Boolean);

  if (!ids.length) {
    return;
  }

  await Job.updateMany(
    {
      _id: {
        $in: ids,
      },
    },
    {
      $set: {
        aiStatus: "processing",

        aiError: null,
      },

      $inc: {
        aiAttempts: 1,
      },
    },
  );
}

/* =========================================================
   MAIN PIPELINE
========================================================= */

async function runPipeline() {
  console.log("🚀 Starting Job Search Pipeline...");

  await mongoose.connect(process.env.MONGODB_URI);

  console.log("Connected to MongoDB.");

  try {
    /* =====================================================
       A. EXISTING QUEUE
    ===================================================== */

    const pendingJobs = await getPendingJobs();

    if (pendingJobs.length) {
      console.log(
        `🔄 Found ${pendingJobs.length} pending/failed jobs from previous runs.`,
      );
    } else {
      console.log("🔄 No pending jobs from previous runs.");
    }

    /*
     * Existing queue gets priority.
     */
    const aiQueue = [...pendingJobs];

    const queuedDedupeKeys = new Set(
      pendingJobs.map((job) => job.dedupeKey).filter(Boolean),
    );

    /* =====================================================
       B. APIFY SEARCHES
    ===================================================== */

    const allScrapedJobs = [];

    console.log(
      `🔎 Running ${LINKEDIN_SEARCHES.length} targeted LinkedIn searches...`,
    );

    for (const searchTerm of LINKEDIN_SEARCHES) {
      console.log(`\n🔍 Searching LinkedIn for: "${searchTerm}"`);

      const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(
        searchTerm,
      )}&location=India&f_TPR=r604800`;

      try {
        const run = await apify
          .actor("curious_coder/linkedin-jobs-scraper")
          .call({
            urls: [searchUrl],

            count: JOBS_PER_SEARCH,
          });

        const { items } = await apify.dataset(run.defaultDatasetId).listItems();

        console.log(`📥 "${searchTerm}" → ${items.length} jobs`);

        for (const item of items) {
          allScrapedJobs.push({
            ...item,

            searchQuery: searchTerm,
          });
        }
      } catch (error) {
        console.error(
          `❌ Search failed for "${searchTerm}":`,
          error?.message || error,
        );
      }
    }

    console.log(`\n📊 Total raw jobs scraped: ${allScrapedJobs.length}`);

    /* =====================================================
       C. CURRENT-RUN DEDUPLICATION
    ===================================================== */

    const uniqueScrapedJobs = [];

    const seenJobIds = new Set();

    const seenDedupeKeys = new Set();

    for (const rawJob of allScrapedJobs) {
      const id =
        rawJob.id || rawJob.jobId || rawJob.jobUrl || rawJob.link || rawJob.url;

      const title =
        rawJob.title || rawJob.positionName || rawJob.jobTitle || "";

      const company = rawJob.companyName || rawJob.company || "";

      const dedupeKey = createDedupeKey(title, company);

      if (id && seenJobIds.has(id)) {
        console.log(`♻️ Duplicate job ID: ${id}`);

        continue;
      }

      if (isStrongDedupeTitle(title) && seenDedupeKeys.has(dedupeKey)) {
        console.log(`♻️ Duplicate role: ${title} at ${company}`);

        continue;
      }

      if (id) {
        seenJobIds.add(id);
      }

      if (isStrongDedupeTitle(title)) {
        seenDedupeKeys.add(dedupeKey);
      }

      uniqueScrapedJobs.push(rawJob);
    }

    console.log(
      `🧹 After current-run deduplication: ${uniqueScrapedJobs.length} unique jobs`,
    );

    /* =====================================================
       D. FILTER + SAVE NEW JOBS
    ===================================================== */

    for (const rawJob of uniqueScrapedJobs) {
      const job = {
        id:
          rawJob.id ||
          rawJob.jobId ||
          rawJob.jobUrl ||
          rawJob.link ||
          rawJob.url,

        title:
          rawJob.title ||
          rawJob.positionName ||
          rawJob.jobTitle ||
          "Software Engineer",

        company: rawJob.companyName || rawJob.company || "Company",

        url: rawJob.jobUrl || rawJob.link || rawJob.url || rawJob.applyUrl,

        description:
          rawJob.description ||
          rawJob.descriptionText ||
          rawJob.jobDescription ||
          rawJob.text ||
          "",

        location: rawJob.location || "",

        postedAt: getPostedDate(rawJob),
      };

      if (!job.id && job.url) {
        job.id = job.url;
      }

      if (!job.id || !job.description) {
        console.log(`⚠️ Skipped "${job.title}" - Missing ID or description.`);

        continue;
      }

      /*
       * 7-DAY FILTER
       */
      if (!isWithinLastSevenDays(job.postedAt)) {
        console.log(`📅 Skipped old job: ${job.title}`);

        continue;
      }

      console.log(
        `📅 Fresh job: ${job.title} at ${job.company} - Posted ${job.postedAt.toISOString()}`,
      );

      /*
       * STRICT LOCAL FILTER
       */
      if (!isRelevantJob(job)) {
        console.log(
          `🚫 Local relevance filter rejected: ${job.title} at ${job.company}`,
        );

        continue;
      }

      console.log(`✅ Passed local filter: ${job.title} at ${job.company}`);

      const dedupeKey = createDedupeKey(job.title, job.company);

      /*
       * Exact LinkedIn ID.
       */
      const existingById = await Job.findOne({
        jobId: job.id,
      });

      if (existingById) {
        console.log(
          `⏭️ Already in MongoDB: ${job.title} at ${job.company} (${existingById.aiStatus})`,
        );

        continue;
      }

      /*
       * Normalized role/company.
       */
      if (isStrongDedupeTitle(job.title)) {
        const existingByDedupe = await Job.findOne({
          dedupeKey,
        });

        if (existingByDedupe) {
          console.log(
            `♻️ Similar job already exists: ${job.title} at ${job.company}`,
          );

          continue;
        }

        if (queuedDedupeKeys.has(dedupeKey)) {
          console.log(
            `♻️ Similar job already queued: ${job.title} at ${job.company}`,
          );

          continue;
        }
      }

      try {
        const savedJob = await Job.create({
          jobId: job.id,

          title: job.title,

          company: job.company,

          url: job.url,

          description: job.description,

          location: job.location,

          postedAt: job.postedAt,

          dedupeKey,

          aiStatus: "pending",
        });

        aiQueue.push({
          ...job,

          mongoId: savedJob._id,

          dedupeKey,
        });

        queuedDedupeKeys.add(dedupeKey);

        console.log(`💾 Saved as pending: ${job.title} at ${job.company}`);
      } catch (error) {
        if (error?.code === 11000) {
          console.log(`♻️ Duplicate detected while saving: ${job.title}`);

          continue;
        }

        throw error;
      }
    }

    /* =====================================================
       E. AI QUEUE
    ===================================================== */

    aiQueue.sort(
      (a, b) => new Date(a.postedAt).getTime() - new Date(b.postedAt).getTime(),
    );

    console.log(`\n🤖 ${aiQueue.length} jobs are waiting for AI evaluation.`);

    const aiBatch = aiQueue.slice(0, MAX_AI_BATCH_SIZE);

    const deferred = Math.max(0, aiQueue.length - aiBatch.length);

    console.log(`🤖 ${aiBatch.length} jobs will be evaluated in this run.`);

    if (deferred) {
      console.log(`⏳ ${deferred} jobs remain pending for a future run.`);
    }

    if (!aiBatch.length) {
      console.log("No jobs require AI evaluation.");

      return;
    }

    /* =====================================================
       F. MARK PROCESSING
    ===================================================== */

    await markJobsAsProcessing(aiBatch);

    /* =====================================================
       G. GEMINI
    ===================================================== */

    const aiResponse = await scoreJobsWithAI(aiBatch, CANDIDATE_RESUME);

    /* =====================================================
       H. QUOTA
    ===================================================== */

    if (aiResponse.status === "quota") {
      await Job.updateMany(
        {
          _id: {
            $in: aiBatch.map((job) => job.mongoId),
          },
        },
        {
          $set: {
            aiStatus: "pending",

            aiError: "Gemini quota/rate limit reached.",
          },
        },
      );

      console.log("🔄 Gemini quota reached.");

      console.log("↩️ Jobs returned to pending.");

      console.log("⏭️ They will retry on the next scheduled run.");

      return;
    }

    /* =====================================================
       I. GENERAL AI FAILURE
    ===================================================== */

    if (aiResponse.status === "failed") {
      await Job.updateMany(
        {
          _id: {
            $in: aiBatch.map((job) => job.mongoId),
          },
        },
        {
          $set: {
            aiStatus: "failed",

            aiError: "Gemini evaluation failed.",
          },
        },
      );

      console.log("⚠️ Gemini evaluation failed.");

      return;
    }

    /* =====================================================
       J. PROCESS RESULTS
    ===================================================== */

    const processedIndexes = new Set();

    for (const result of aiResponse.results) {
      const job = aiBatch[result.index];

      if (!job) {
        continue;
      }

      processedIndexes.add(result.index);

      const score = Number(result.shortlist_score);

      console.log(`🎯 ${job.title} at ${job.company} → ${score}/10`);

      await Job.findByIdAndUpdate(job.mongoId, {
        $set: {
          score,

          analysis: result.match_analysis,

          missingSkills: Array.isArray(result.missing_skills)
            ? result.missing_skills
            : [],

          aiStatus: "completed",

          aiProcessedAt: new Date(),

          aiError: null,
        },
      });

      /*
       * Slack only for 7+.
       */
      if (score >= SLACK_SCORE_THRESHOLD) {
        const slackSent = await sendNotification(job, result);

        if (slackSent) {
          await Job.findByIdAndUpdate(job.mongoId, {
            $set: {
              slackNotified: true,

              slackNotifiedAt: new Date(),
            },
          });
        }
      } else {
        console.log(`📭 Not sending to Slack: ${job.title} (${score}/10)`);
      }
    }

    /* =====================================================
       K. UNPROCESSED RESULTS
    ===================================================== */

    const missing = aiBatch.filter((_, index) => !processedIndexes.has(index));

    if (missing.length) {
      await Job.updateMany(
        {
          _id: {
            $in: missing.map((job) => job.mongoId),
          },
        },
        {
          $set: {
            aiStatus: "pending",

            aiError: "Gemini did not return an evaluation.",
          },
        },
      );

      console.log(`↩️ ${missing.length} jobs returned to pending.`);
    }

    console.log("\n✅ Pipeline run complete.");
  } catch (error) {
    console.error("❌ Pipeline Error:", error?.message || error);
  } finally {
    await mongoose.disconnect();

    console.log("MongoDB connection closed.");
  }
}

/* =========================================================
   START
========================================================= */

runPipeline();
