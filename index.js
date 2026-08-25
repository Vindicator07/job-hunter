import { ApifyClient } from "apify-client";
import mongoose from "mongoose";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

/* =========================================================
   1. CONFIGURATION
========================================================= */

const MAX_JOB_AGE_DAYS = 7;

// Maximum number of jobs sent to Gemini in one request.
// Keeping this bounded prevents a large pending backlog
// from creating an unnecessarily large AI request.
const MAX_AI_BATCH_SIZE = 10;

// Only jobs with this score or higher are sent to Slack.
const SLACK_SCORE_THRESHOLD = 7;

// Maximum number of pending jobs we look for in MongoDB.
const MAX_PENDING_JOBS_TO_LOAD = 20;

/* =========================================================
   2. INITIALIZE CLIENTS
========================================================= */

const apify = new ApifyClient({
  token: process.env.APIFY_TOKEN,
});

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

/* =========================================================
   3. CANDIDATE RESUME
========================================================= */

const CANDIDATE_RESUME = `

MAYANK MISHRA

Senior Software Engineer | Node.js, TypeScript, React.js, Nest.JS, Express.js, MongoDB, PostgreSQL, AWS

Email: mishramayank665@gmail.com | Phone: +91-9793870847 | GitHub: Vindicator07

PROFESSIONAL SUMMARY

• Senior Software Engineer with 4+ years of experience building scalable backend and full-stack applications, specializing in Node.js, TypeScript, distributed systems, and API-driven architectures.

• Experienced in designing multi-tenant, real-time, and production-scale systems, with expertise in secure authentication, third-party integrations, database optimization, system design, and cloud deployments.

TECHNICAL SKILLS

• Languages: JavaScript, TypeScript, SQL

• Frontend: React.js, Angular, Redux

• Backend & APIs: Node.js, Nest.JS, Express.js, REST, GraphQL, Strapi

• Databases: PostgreSQL, MongoDB, Redis

• Integrations & Real-Time: Paystack, Webhooks, Zoom Video SDK, Socket.IO, Server-Sent Events, Firebase Cloud Messaging

• Cloud, DevOps & Tools: AWS (EC2, S3, Lambda), Docker, Git, GitHub, Kafka, Postman, Swagger

• Architecture & System Design: System Design, Microservices, Multi-Tenancy, Event-Driven Architecture, Scalability, Distributed Systems, Asynchronous Programming

WORK EXPERIENCE

Senior Software Engineer | iSon Xperiences

Jan 2026 - Present | Noida, India

• Designed and engineered the backend architecture of a multi-country, multi-tenant telemedicine platform using Node.js, TypeScript, Express.js, and MongoDB, supporting 750+ patients, 40+ healthcare professionals, 2 countries, and 3 tenants.

• Designed end-to-end appointment and teleconsultation workflows handling 200-300 monthly consultations, including availability, slot management, booking, rescheduling, cancellations, family-member appointments, consent, feedback, and automated no-show handling.

• Integrated Zoom Video SDK and engineered real-time communication using Socket.IO and Server-Sent Events, enabling secure consultations, doctor assignment, presence tracking, chat, file sharing, and live call-status updates for 50+ concurrent connections.

• Designed production-grade authentication and authorization using JWT access/refresh tokens, RBAC, OTP, token revocation, device-bound sessions, bcrypt, and biometric public-key verification.

• Integrated Paystack subscription-based payments with HMAC-verified, idempotent webhooks, handling 500+ monthly payment events for subscription creation, payment verification, renewals, cancellations, and refunds.

• Integrated Firebase Cloud Messaging, Strapi, AWS S3-compatible storage, and Puppeteer, supporting 4,000+ monthly notifications while automating localized content management, secure medical-document storage, and clinical document generation, reducing manual preparation by 60%.

Digital Specialist Engineer | Infosys

Aug 2022 - Dec 2025 | Noida, India

• Developed and optimized scalable backend services using Node.js, NestJS, and PostgreSQL, improving system throughput by 40% and reducing data-processing time by 30-35%.

• Designed and integrated REST and GraphQL APIs with Angular and React applications, improving application responsiveness and maintainability across enterprise modules.

• Implemented JWT authentication and RBAC and supported AWS-based deployments using EC2, S3, and Docker, contributing to a 99.9% production uptime.

• Refactored legacy monolithic modules into microservices and optimized database access patterns, improving scalability, reliability, and deployment efficiency.

EDUCATION

Shri Ram Murti Smarak College of Engineering and Technology

Bachelor of Technology in Information Technology (2018–2022) | Bareilly, India

`;

/* =========================================================
   4. MONGODB SCHEMA
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

    url: {
      type: String,
    },

    description: {
      type: String,
    },

    location: {
      type: String,
    },

    postedAt: {
      type: Date,
      index: true,
    },

    score: {
      type: Number,
    },

    analysis: {
      type: String,
    },

    missingSkills: {
      type: [String],
      default: [],
    },

    /*
     * AI lifecycle:
     *
     * pending
     *    ↓
     * processing
     *    ↓
     * completed
     *
     * or
     *
     * processing
     *    ↓
     * failed
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

    aiProcessedAt: {
      type: Date,
    },

    aiError: {
      type: String,
    },

    /*
     * Slack lifecycle is separate from AI lifecycle.
     */
    slackNotified: {
      type: Boolean,
      default: false,
    },

    slackNotifiedAt: {
      type: Date,
    },

    applied: {
      type: Boolean,
      default: false,
      index: true,
    },

    appliedAt: {
      type: Date,
    },

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
   5. JOB RELEVANCE FILTER
========================================================= */

const RELEVANT_KEYWORDS = [
  "node.js",
  "nodejs",
  "typescript",
  "nestjs",
  "nest.js",
  "express.js",
  "express",
  "backend",
  "back-end",
  "server-side",
  "software engineer",
  "software developer",
  "software development engineer",
  "full stack",
  "full-stack",
  "api",
  "microservices",
  "rest",
  "graphql",
  "mongodb",
  "postgresql",
  "postgres",
  "redis",
  "kafka",
  "aws",
];

function isRelevantJob(job) {
  const text = `${job.title} ${job.description}`.toLowerCase();

  const matchedKeywords = RELEVANT_KEYWORDS.filter((keyword) =>
    text.includes(keyword),
  );

  const hasNode = text.includes("node.js") || text.includes("nodejs");

  const hasBackend =
    text.includes("backend") ||
    text.includes("back-end") ||
    text.includes("server-side");

  const hasSoftwareRole =
    text.includes("software engineer") ||
    text.includes("software developer") ||
    text.includes("software development engineer") ||
    text.includes("developer");

  return (
    (hasNode && hasBackend) ||
    (hasNode && hasSoftwareRole) ||
    matchedKeywords.length >= 3
  );
}

/* =========================================================
   6. JOB DATE HANDLING
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

  /*
   * Handle Unix timestamps.
   */
  if (typeof postedAt === "number") {
    /*
     * If timestamp is in seconds, convert to milliseconds.
     */
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
  if (!postedAt) {
    return false;
  }

  return postedAt >= getSevenDaysAgo();
}

/* =========================================================
   7. LOAD PENDING JOBS
========================================================= */

async function getPendingJobs() {
  const sevenDaysAgo = getSevenDaysAgo();

  /*
   * We only retry:
   *
   * pending
   * failed
   *
   * jobs that are still within our 7-day window.
   */
  const pendingJobs = await Job.find({
    aiStatus: {
      $in: ["pending", "failed"],
    },

    postedAt: {
      $gte: sevenDaysAgo,
    },
  })
    /*
     * Oldest first.
     *
     * This prevents a constantly incoming stream
     * of new jobs from starving older pending jobs.
     */
    .sort({
      postedAt: 1,
    })

    .limit(MAX_PENDING_JOBS_TO_LOAD)

    .lean();

  return pendingJobs.map((job) => ({
    id: job.jobId,

    mongoId: job._id,

    title: job.title,

    company: job.company,

    url: job.url,

    description: job.description || "",

    location: job.location || "",

    postedAt: job.postedAt,
  }));
}

/* =========================================================
   8. GEMINI BATCH SCORING
========================================================= */

async function scoreJobsWithAI(jobs, resumeText) {
  if (!jobs.length) {
    console.log("🤖 No jobs require Gemini evaluation.");

    return [];
  }

  console.log(`🤖 Sending ${jobs.length} jobs to Gemini in ONE request...`);

  const jobsForAI = jobs.map((job, index) => ({
    index,

    title: job.title,

    company: job.company,

    location: job.location,

    postedAt: job.postedAt ? job.postedAt.toISOString() : null,

    description: job.description,
  }));

  const prompt = `
You are an expert technical recruiter evaluating software engineering jobs against a candidate's resume.

Evaluate ALL jobs provided below.

SCORING RULES:

10 = Exceptional match. Candidate matches almost everything important.
9 = Excellent match. Strong technical and experience alignment.
8 = Very strong match. Clearly worth applying.
7 = Strong match. Good opportunity and worth applying.
6 = Moderate match. Some meaningful gaps.
5 = Partial match.
4 or below = Weak match.

IMPORTANT:

- Do NOT give a high score simply because the job mentions Node.js.
- Evaluate actual responsibilities.
- Evaluate required technologies.
- Evaluate seniority.
- Evaluate years of experience.
- Evaluate backend/full-stack alignment.
- Evaluate system design and architecture requirements.
- Evaluate database requirements.
- Evaluate AWS/cloud requirements.
- Evaluate distributed systems/microservices requirements.
- Evaluate whether the candidate realistically meets the seniority level.
- Penalize major missing mandatory requirements.
- Do NOT heavily penalize optional skills.
- Prefer backend and full-stack roles.
- Node.js + TypeScript + backend/API development is highly relevant.
- Node.js + AWS + distributed systems is highly relevant.
- A role that is primarily frontend, QA, DevOps, data science, mobile, Java-only, .NET-only, or otherwise unrelated should score low.
- Do not inflate scores.
- Be realistic about missing skills.
- Keep match_analysis to exactly 2 concise sentences.
- Return exactly one result for every input job.
- The index must exactly match the supplied job index.

CANDIDATE RESUME:

${resumeText}

JOBS:

${JSON.stringify(jobsForAI)}

Return STRICT JSON only:

{
  "results": [
    {
      "index": 0,
      "shortlist_score": 1,
      "match_analysis": "Two concise sentences explaining the match.",
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
      console.error("❌ Gemini returned an empty response.");

      return [];
    }

    const parsed = JSON.parse(response.text);

    if (!parsed || !Array.isArray(parsed.results)) {
      console.error("❌ Gemini returned an invalid result structure.");

      return [];
    }

    /*
     * Validate each result before trusting it.
     */
    const validResults = parsed.results.filter((result) => {
      return (
        Number.isInteger(result.index) &&
        result.index >= 0 &&
        result.index < jobs.length &&
        typeof result.shortlist_score === "number" &&
        result.shortlist_score >= 1 &&
        result.shortlist_score <= 10 &&
        typeof result.match_analysis === "string"
      );
    });

    console.log(
      `🤖 Gemini returned ${validResults.length}/${jobs.length} valid evaluations.`,
    );

    return validResults;
  } catch (error) {
    if (error.status === 429) {
      console.error("❌ Gemini quota/rate limit reached.");

      console.error("Jobs remain pending for the next run.");
    } else {
      console.error("❌ Gemini batch evaluation failed:", error);
    }

    return [];
  }
}

/* =========================================================
   9. SLACK NOTIFICATION
========================================================= */

async function sendNotification(jobData, aiResult) {
  const payload = {
    text: `🚨 *New High-Scoring Job Match!* (Score: ${aiResult.shortlist_score}/10)

*Title:* ${jobData.title}

*Company:* ${jobData.company}

*Location:* ${jobData.location || "Not specified"}

*Posted:* ${
      jobData.postedAt ? jobData.postedAt.toLocaleString("en-IN") : "Unknown"
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
      console.error(`❌ Slack notification failed for ${jobData.title}`);

      return false;
    }

    console.log(`✅ Slack notification sent for ${jobData.title}`);

    return true;
  } catch (error) {
    console.error("❌ Slack webhook request failed:", error);

    return false;
  }
}

/* =========================================================
   10. MARK JOBS AS PROCESSING
========================================================= */

async function markJobsAsProcessing(jobs) {
  if (!jobs.length) {
    return;
  }

  const ids = jobs.map((job) => job.mongoId).filter(Boolean);

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
   11. MARK BATCH AS FAILED
========================================================= */

async function markBatchAsFailed(jobs, errorMessage) {
  if (!jobs.length) {
    return;
  }

  const ids = jobs.map((job) => job.mongoId).filter(Boolean);

  await Job.updateMany(
    {
      _id: {
        $in: ids,
      },
    },
    {
      $set: {
        aiStatus: "failed",
        aiError: errorMessage,
      },
    },
  );
}

/* =========================================================
   12. MAIN PIPELINE
========================================================= */

async function runPipeline() {
  console.log("🚀 Starting Job Search Pipeline...");

  await mongoose.connect(process.env.MONGODB_URI);

  console.log("Connected to MongoDB.");

  try {
    /* =====================================================
       A. LOAD PENDING JOBS FIRST
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
     * This is the master AI queue for this run.
     */
    let aiQueue = [...pendingJobs];

    /*
     * Keep track of MongoDB IDs already in the queue.
     * This prevents duplicate AI evaluation.
     */
    const queuedMongoIds = new Set(
      pendingJobs.map((job) => String(job.mongoId)),
    );

    /* =====================================================
       B. APIFY SCRAPER
       
       r604800 = LinkedIn jobs posted
       within the last 7 days.
    ===================================================== */

    const run = await apify.actor("curious_coder/linkedin-jobs-scraper").call({
      urls: [
        "https://www.linkedin.com/jobs/search/?keywords=Node.js%20Developer&location=India&f_TPR=r604800",
      ],

      count: 10,
    });

    /* =====================================================
       C. GET APIFY RESULTS
    ===================================================== */

    const { items } = await apify.dataset(run.defaultDatasetId).listItems();

    console.log(`Scraped ${items.length} jobs from Apify.`);

    /* =====================================================
       D. PROCESS FRESH APIFY JOBS
    ===================================================== */

    for (const rawJob of items) {
      const postedAt = getPostedDate(rawJob);

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

        postedAt,
      };

      /* ===================================================
         FALLBACK ID
      =================================================== */

      if (!job.id && job.url) {
        job.id = job.url;
      }

      /* ===================================================
         BASIC VALIDATION
      =================================================== */

      if (!job.id || !job.description) {
        console.log(`⚠️ Skipped "${job.title}" - Missing ID or description.`);

        continue;
      }

      /* ===================================================
         STRICT 7-DAY CHECK
      =================================================== */

      if (!job.postedAt) {
        console.log(
          `⚠️ Skipped "${job.title}" - Could not determine posted date.`,
        );

        continue;
      }

      if (!isWithinLastSevenDays(job.postedAt)) {
        const ageInDays =
          (Date.now() - job.postedAt.getTime()) / (1000 * 60 * 60 * 24);

        console.log(
          `📅 Skipped old job: ${job.title} at ${job.company} (${ageInDays.toFixed(
            1,
          )} days old)`,
        );

        continue;
      }

      console.log(
        `📅 Fresh job: ${job.title} at ${job.company} - Posted ${job.postedAt.toISOString()}`,
      );

      /* ===================================================
         DATABASE DUPLICATE CHECK
      =================================================== */

      const existingJob = await Job.findOne({
        jobId: job.id,
      });

      if (existingJob) {
        console.log(
          `⏭️ Already in MongoDB: ${job.title} at ${job.company} (${existingJob.aiStatus})`,
        );

        /*
         * If it's already pending/failed, it was loaded
         * into the queue above.
         *
         * If it's completed, nothing else is required.
         */
        continue;
      }

      /* ===================================================
         LOCAL RELEVANCE FILTER
      =================================================== */

      if (!isRelevantJob(job)) {
        console.log(`🔍 Local filter skipped: ${job.title} at ${job.company}`);

        continue;
      }

      console.log(`✅ Passed local filter: ${job.title} at ${job.company}`);

      /* ===================================================
         SAVE BEFORE GEMINI
      =================================================== */

      const savedJob = await Job.create({
        jobId: job.id,

        title: job.title,

        company: job.company,

        url: job.url,

        description: job.description,

        location: job.location,

        postedAt: job.postedAt,

        aiStatus: "pending",
      });

      const queueJob = {
        ...job,

        mongoId: savedJob._id,
      };

      /*
       * Prevent duplicate queue entries.
       */
      const mongoIdString = String(savedJob._id);

      if (!queuedMongoIds.has(mongoIdString)) {
        aiQueue.push(queueJob);

        queuedMongoIds.add(mongoIdString);
      }

      console.log(`💾 Saved as pending: ${job.title} at ${job.company}`);
    }

    /* =====================================================
       E. LIMIT AI BATCH SIZE
       
       Prioritize oldest pending jobs first.
    ===================================================== */

    aiQueue.sort((a, b) => {
      const aTime = a.postedAt?.getTime?.() || 0;

      const bTime = b.postedAt?.getTime?.() || 0;

      return aTime - bTime;
    });

    /*
     * Only send a bounded number of jobs to Gemini.
     */
    const aiBatch = aiQueue.slice(0, MAX_AI_BATCH_SIZE);

    const deferredJobs = aiQueue.slice(MAX_AI_BATCH_SIZE);

    console.log(`🤖 ${aiQueue.length} jobs are waiting for AI evaluation.`);

    console.log(`🤖 ${aiBatch.length} jobs will be evaluated in this run.`);

    if (deferredJobs.length) {
      console.log(
        `⏳ ${deferredJobs.length} jobs remain pending for a future run.`,
      );
    }

    /* =====================================================
       F. NOTHING TO PROCESS
    ===================================================== */

    if (!aiBatch.length) {
      console.log("No jobs require AI evaluation.");

      return;
    }

    /* =====================================================
       G. MARK BATCH AS PROCESSING
    ===================================================== */

    await markJobsAsProcessing(aiBatch);

    /* =====================================================
       H. GEMINI
    ===================================================== */

    let aiResults = [];

    try {
      aiResults = await scoreJobsWithAI(aiBatch, CANDIDATE_RESUME);
    } catch (error) {
      console.error("❌ Unexpected Gemini error:", error);
    }

    /* =====================================================
       I. GEMINI FAILURE
       
       Put jobs back into pending/failed so the next run
       can retry them.
    ===================================================== */

    if (!aiResults.length) {
      await markBatchAsFailed(
        aiBatch,
        "Gemini evaluation failed or quota was unavailable.",
      );

      console.log("⚠️ No AI results returned.");

      console.log(
        "🔄 Jobs marked as failed and will be retried on the next run.",
      );

      return;
    }

    /* =====================================================
       J. UPDATE SUCCESSFUL AI RESULTS
    ===================================================== */

    const processedIndexes = new Set();

    for (const result of aiResults) {
      const job = aiBatch[result.index];

      if (!job) {
        console.log(`⚠️ Invalid Gemini job index: ${result.index}`);

        continue;
      }

      processedIndexes.add(result.index);

      const score = Number(result.shortlist_score);

      console.log(`🎯 ${job.title} at ${job.company} → ${score}/10`);

      /* ===================================================
         UPDATE MONGODB
      =================================================== */

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

      /* ===================================================
         SLACK
      =================================================== */

      if (score >= SLACK_SCORE_THRESHOLD) {
        /*
         * Send Slack notification.
         *
         * If Slack fails, the job remains completed.
         * We do NOT re-run Gemini just because Slack failed.
         */
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
       K. HANDLE MISSING GEMINI RESULTS
       
       If Gemini returned only some jobs, the missing ones
       must remain retryable.
    ===================================================== */

    const missingResults = aiBatch.filter(
      (_, index) => !processedIndexes.has(index),
    );

    if (missingResults.length) {
      await markBatchAsFailed(
        missingResults,
        "Gemini did not return an evaluation for this job.",
      );

      console.log(
        `⚠️ ${missingResults.length} jobs did not receive an AI result and will be retried.`,
      );
    }

    console.log("✅ Pipeline run complete.");
  } catch (error) {
    console.error("❌ Pipeline Error:", error);
  } finally {
    await mongoose.disconnect();

    console.log("MongoDB connection closed.");
  }
}

/* =========================================================
   13. EXECUTE
========================================================= */

runPipeline();
