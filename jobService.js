import Job from "./job.js";

import { MAX_PENDING_JOBS_TO_LOAD } from "./constants.js";

import { createDedupeKey } from "./utils.js";

/* =========================================================
   GET PENDING JOBS
========================================================= */

export async function getPendingJobs() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const jobs = await Job.find({
    aiStatus: {
      $in: ["pending", "failed"],
    },

    postedAt: {
      $gte: sevenDaysAgo,
    },
  })
    .sort({
      postedAt: 1,
    })
    .limit(MAX_PENDING_JOBS_TO_LOAD)
    .lean();

  return jobs;
}

/* =========================================================
   SAVE NEW JOBS
========================================================= */

export async function saveNewJobs(jobs) {
  const savedJobs = [];

  for (const job of jobs) {
    const dedupeKey = createDedupeKey(job.title, job.company);

    /*
     * Check exact job ID.
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
     * Check normalized company + title.
     */
    const existingByDedupe = await Job.findOne({
      dedupeKey,
    });

    if (existingByDedupe) {
      console.log(
        `♻️ Similar job already exists: ${job.title} at ${job.company}`,
      );

      continue;
    }

    try {
      const saved = await Job.create({
        jobId: job.id,

        title: job.title,

        company: job.company,

        url: job.url,

        description: job.description,

        location: job.location,

        postedAt: job.postedAt,

        dedupeKey,

        aiStatus: "pending",

        applicationStatus: "not_applied",
      });

      console.log(`💾 Saved as pending: ${job.title} at ${job.company}`);

      savedJobs.push(saved.toObject());
    } catch (error) {
      /*
       * Protect against a race condition
       * where another operation inserted
       * the same job at the same time.
       */
      if (error?.code === 11000) {
        console.log(`♻️ Duplicate detected while saving: ${job.title}`);

        continue;
      }

      throw error;
    }
  }

  return savedJobs;
}

/* =========================================================
   MARK PROCESSING
========================================================= */

export async function markJobsProcessing(jobs) {
  const ids = jobs.map((job) => job._id);

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
   MARK PENDING
========================================================= */

export async function markJobsPending(jobs, reason) {
  const ids = jobs.map((job) => job._id);

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
        aiStatus: "pending",

        aiError: reason,
      },
    },
  );
}

/* =========================================================
   MARK FAILED
========================================================= */

export async function markJobsFailed(jobs, reason) {
  const ids = jobs.map((job) => job._id);

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
        aiStatus: "failed",

        aiError: reason,
      },
    },
  );
}

/* =========================================================
   SAVE GEMINI RESULTS
========================================================= */

export async function saveAIResults(jobs, results) {
  const processedIndexes = new Set();

  for (const result of results) {
    const job = jobs[result.index];

    if (!job) {
      continue;
    }

    processedIndexes.add(result.index);

    const score = Number(result.shortlist_score);

    const missingSkills = Array.isArray(result.missing_skills)
      ? result.missing_skills
      : [];

    /*
     * A score >= 7 means:
     *
     * "This job is worth applying to."
     *
     * It does NOT mean:
     *
     * "The user already applied."
     */
    const applicationStatus = score >= 7 ? "ready_to_apply" : "not_applied";

    await Job.findByIdAndUpdate(
      job._id,

      {
        $set: {
          score,

          analysis: result.match_analysis,

          missingSkills,

          aiStatus: "completed",

          aiProcessedAt: new Date(),

          aiError: null,

          applicationStatus,
        },
      },
    );
  }

  /*
   * Gemini may theoretically return fewer
   * results than jobs sent.
   *
   * Never silently lose those jobs.
   */
  const missingJobs = jobs.filter((_, index) => !processedIndexes.has(index));

  if (missingJobs.length) {
    await markJobsPending(missingJobs, "Gemini did not return an evaluation.");

    console.log(`↩️ ${missingJobs.length} jobs returned to pending.`);
  }
}

/* =========================================================
   APPLICATION STATUS
========================================================= */

export async function markJobReadyToApply(jobId) {
  return Job.findByIdAndUpdate(
    jobId,

    {
      $set: {
        applicationStatus: "ready_to_apply",
      },
    },

    {
      new: true,
    },
  );
}

export async function markJobApplied(jobId) {
  return Job.findByIdAndUpdate(
    jobId,

    {
      $set: {
        applicationStatus: "applied",

        appliedAt: new Date(),
      },
    },

    {
      new: true,
    },
  );
}

export async function updateApplicationStatus(jobId, status) {
  const allowedStatuses = [
    "not_applied",
    "ready_to_apply",
    "applied",
    "rejected",
    "interview",
    "offer",
  ];

  if (!allowedStatuses.includes(status)) {
    throw new Error(`Invalid application status: ${status}`);
  }

  return Job.findByIdAndUpdate(
    jobId,

    {
      $set: {
        applicationStatus: status,

        ...(status === "applied"
          ? {
              appliedAt: new Date(),
            }
          : {}),
      },
    },

    {
      new: true,
    },
  );
}
