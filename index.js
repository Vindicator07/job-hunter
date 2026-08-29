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
    /*
     * 1. Get jobs that were left pending
     *    from previous runs.
     */
    const pendingJobs = await getPendingJobs();

    if (pendingJobs.length > 0) {
      console.log(
        `🔄 Found ${pendingJobs.length} pending jobs from previous runs.`,
      );
    } else {
      console.log("🔄 No pending jobs from previous runs.");
    }

    /*
     * 2. Scrape fresh jobs from LinkedIn
     *    through Apify.
     */
    const scrapedJobs = await scrapeAllJobSearches();

    console.log(`📊 Scraped ${scrapedJobs.length} unique jobs.`);

    /*
     * 3. Apply our cheap/local filters:
     *
     *    - Maximum 7 days old
     *    - Backend / Node.js / TypeScript /
     *      Full-stack / relevant software roles
     */
    const relevantJobs = filterFreshRelevantJobs(scrapedJobs);

    console.log(`🎯 ${relevantJobs.length} jobs passed local filtering.`);

    /*
     * 4. Save new jobs to MongoDB.
     *
     *    New jobs are stored as:
     *
     *    aiStatus = pending
     *
     *    They are NOT sent directly to Gemini here.
     */
    const newJobs = await saveNewJobs(relevantJobs);

    /*
     * 5. Combine:
     *
     *    old pending jobs
     *          +
     *    newly discovered jobs
     *
     *    This is our AI queue.
     */
    const jobsWaitingForAI = [...pendingJobs, ...newJobs];

    console.log(
      `🤖 ${jobsWaitingForAI.length} jobs are waiting for AI evaluation.`,
    );

    /*
     * 6. Protect Gemini quota.
     *
     *    We evaluate only a small batch
     *    on each run.
     */
    const aiBatch = jobsWaitingForAI.slice(0, MAX_AI_BATCH_SIZE);

    console.log(`🤖 ${aiBatch.length} jobs will be evaluated in this run.`);

    if (aiBatch.length === 0) {
      console.log("No jobs require AI evaluation.");

      return;
    }

    /*
     * 7. Mark jobs as "processing" before
     *    calling Gemini.
     */
    await markJobsProcessing(aiBatch);

    /*
     * 8. Send the batch to Gemini.
     */
    const aiResponse = await evaluateJobsWithGemini(aiBatch);

    /*
     * 9. Gemini quota/rate limit.
     *
     *    IMPORTANT:
     *
     *    We don't lose the jobs.
     *
     *    They go back to pending and will
     *    be retried during a future run.
     */
    if (aiResponse.status === "quota") {
      await markJobsPending(aiBatch, "Gemini quota/rate limit reached.");

      console.log("❌ Gemini quota/rate limit reached.");

      console.log("↩️ Jobs returned to pending.");

      console.log("⏭️ They will retry on the next scheduled run.");

      return;
    }

    /*
     * 10. General Gemini failure.
     *
     *     We don't pretend the jobs were
     *     successfully evaluated.
     */
    if (aiResponse.status === "failed") {
      await markJobsFailed(aiBatch, "Gemini evaluation failed.");

      console.log("⚠️ Gemini evaluation failed.");

      return;
    }

    /*
     * 11. Save Gemini results.
     *
     *     This updates:
     *
     *     - score
     *     - analysis
     *     - missing skills
     *     - aiStatus
     *     - applicationStatus
     */
    await saveAIResults(aiBatch, aiResponse.results);

    /*
     * 12. Notify Slack only for strong
     *     matches.
     */
    for (const result of aiResponse.results) {
      const job = aiBatch[result.index];

      if (!job) {
        continue;
      }

      if (result.shortlist_score >= 7) {
        const sent = await sendSlackNotification(job, result);

        if (!sent) {
          console.log(`⚠️ Slack notification failed for ${job.title}`);
        }
      } else {
        console.log(
          `📭 Not sending to Slack: ${job.title} (${result.shortlist_score}/10)`,
        );
      }
    }

    console.log("✅ Pipeline run complete.");
  } catch (error) {
    console.error("❌ Pipeline Error:", error?.message || error);
  } finally {
    await mongoose.disconnect();

    console.log("MongoDB connection closed.");
  }
}

run();
