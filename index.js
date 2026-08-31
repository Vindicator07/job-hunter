import mongoose from "mongoose";

import { config } from "./config.js";

import { MAX_AI_BATCH_SIZE } from "./constants.js";

import {
  getPendingJobs,
  saveNewJobs,
  markJobsProcessing,
  markJobsPending,
  markJobsFailed,
  saveAIResults,
  updateNotificationStatus,
} from "./jobService.js";

import { scrapeAllJobSearches } from "./apify.js";

import { filterFreshRelevantJobs } from "./jobFilter.js";

import { evaluateJobsWithGemini } from "./gemini.js";

import { sendSlackNotification } from "./slack.js";

async function run() {
  console.log("🚀 Starting Job Search Pipeline...");

  await mongoose.connect(config.mongodbUri);

  console.log("Connected to MongoDB.");

  try {
    /* =========================================================
       1. GET PENDING / FAILED JOBS
       ========================================================= */

    const pendingJobs = await getPendingJobs();

    if (pendingJobs.length > 0) {
      console.log(
        `🔄 Found ${pendingJobs.length} pending/failed jobs from previous runs.`,
      );
    } else {
      console.log("🔄 No pending jobs from previous runs.");
    }

    /* =========================================================
       2. SCRAPE FRESH JOBS
       ========================================================= */

    const scrapedJobs = await scrapeAllJobSearches();

    console.log(`📊 Scraped ${scrapedJobs.length} unique jobs.`);

    /* =========================================================
       3. APPLY LOCAL FILTERS
       
       - Maximum 7 days old
       - Backend / Node.js / TypeScript
       - Full-stack / relevant software roles
       ========================================================= */

    const relevantJobs = filterFreshRelevantJobs(scrapedJobs);

    console.log(`🎯 ${relevantJobs.length} jobs passed local filtering.`);

    /* =========================================================
       4. SAVE NEW JOBS TO MONGODB

       New jobs start with:

       aiStatus = pending
       applicationStatus = not_applied
       ========================================================= */

    const newJobs = await saveNewJobs(relevantJobs);

    /* =========================================================
       5. BUILD AI QUEUE

       Previous pending jobs
              +
       Newly discovered jobs
              ↓
       AI queue
       ========================================================= */

    const jobsWaitingForAI = [...pendingJobs, ...newJobs];

    console.log(
      `🤖 ${jobsWaitingForAI.length} jobs are waiting for AI evaluation.`,
    );

    /* =========================================================
       6. PROTECT GEMINI QUOTA

       Only process a limited number of jobs per run.
       ========================================================= */

    const aiBatch = jobsWaitingForAI.slice(0, MAX_AI_BATCH_SIZE);

    console.log(`🤖 ${aiBatch.length} jobs will be evaluated in this run.`);

    if (aiBatch.length === 0) {
      console.log("No jobs require AI evaluation.");
      return;
    }

    /* =========================================================
       7. MARK JOBS AS PROCESSING

       This happens BEFORE calling Gemini.

       aiStatus:
       pending → processing
       ========================================================= */

    await markJobsProcessing(aiBatch);

    /* =========================================================
       8. SEND BATCH TO GEMINI
       ========================================================= */

    console.log(`🤖 Sending ${aiBatch.length} jobs to Gemini...`);

    const aiResponse = await evaluateJobsWithGemini(aiBatch);

    /* =========================================================
       9. GEMINI QUOTA / RATE LIMIT

       IMPORTANT:

       Quota errors are temporary.

       Therefore:
       processing → pending

       These jobs can be retried during the next run.
       ========================================================= */

    if (aiResponse.status === "quota") {
      await markJobsPending(aiBatch, "Gemini quota/rate limit reached.");

      console.log("❌ Gemini quota/rate limit reached.");

      console.log("↩️ Jobs returned to pending.");

      console.log("⏭️ They will retry on the next scheduled run.");

      return;
    }

    /* =========================================================
       10. GENERAL GEMINI FAILURE

       The AI request failed for a reason other than
       quota/rate limiting.

       processing → failed

       Notification status:
       pending → ai_failed
       ========================================================= */

    if (aiResponse.status === "failed") {
      await markJobsFailed(aiBatch, "Gemini evaluation failed.");

      for (const job of aiBatch) {
        await updateNotificationStatus(job.jobId, "ai_failed");
      }

      console.log("⚠️ Gemini evaluation failed.");

      console.log(`❌ Marked ${aiBatch.length} jobs as AI failed.`);

      return;
    }

    /* =========================================================
       11. SAVE GEMINI RESULTS

       Updates:

       - score
       - analysis
       - missing skills
       - aiStatus
       - aiProcessedAt
       - applicationStatus

       If Gemini returns fewer results than expected,
       saveAIResults() returns those jobs to pending.
       ========================================================= */

    await saveAIResults(aiBatch, aiResponse.results);

    /* =========================================================
       12. SLACK NOTIFICATIONS

       Score >= 7
           ↓
       Send to Slack

       Score < 7
           ↓
       Do not send
       notificationStatus = below_threshold
       ========================================================= */

    for (const result of aiResponse.results) {
      const job = aiBatch[result.index];

      if (!job) {
        console.log(`⚠️ No job found for AI result index ${result.index}`);

        continue;
      }

      const score = Number(result.shortlist_score);

      /* =====================================================
         HIGH-SCORING JOB
         ===================================================== */

      if (score >= 7) {
        const sent = await sendSlackNotification(job, result);

        if (sent) {
          await updateNotificationStatus(job.jobId, "sent");

          console.log(`✅ Slack notification sent for ${job.title}`);
        } else {
          await updateNotificationStatus(job.jobId, "slack_failed");

          console.log(`❌ Slack notification failed for ${job.title}`);
        }
      } else {

      /* =====================================================
         LOW-SCORING JOB
         ===================================================== */
        await updateNotificationStatus(job.jobId, "below_threshold");

        console.log(`📭 Not sending to Slack: ${job.title} (${score}/10)`);
      }
    }

    /* =========================================================
       13. PIPELINE COMPLETE
       ========================================================= */

    console.log("✅ Pipeline run complete.");
  } catch (error) {
    console.error("❌ Pipeline Error:", error?.message || error);
  } finally {
    await mongoose.disconnect();

    console.log("MongoDB connection closed.");
  }
}

/* =========================================================
   START PIPELINE
   ========================================================= */

run();
