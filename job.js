import mongoose from "mongoose";

const jobSchema = new mongoose.Schema(
  {
    /*
     * =====================================================
     * JOB INFORMATION
     * =====================================================
     */

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
      required: true,
      index: true,
    },

    dedupeKey: {
      type: String,
      index: true,
    },

    /*
     * =====================================================
     * AI INFORMATION
     * =====================================================
     */

    score: {
      type: Number,
      min: 1,
      max: 10,
    },

    analysis: {
      type: String,
    },

    missingSkills: {
      type: [String],
      default: [],
    },

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

    notificationStatus: {
      type: String,
      enum: ["pending", "sent", "below_threshold", "ai_failed", "slack_failed"],
      default: "pending",
    },

    /*
     * =====================================================
     * SLACK
     * =====================================================
     */

    slackNotified: {
      type: Boolean,
      default: false,
    },

    slackNotifiedAt: {
      type: Date,
      default: null,
    },

    /*
     * =====================================================
     * APPLICATION
     * =====================================================
     */

    applicationStatus: {
      type: String,

      enum: [
        "not_applied",
        "ready_to_apply",
        "applied",
        "rejected",
        "interview",
        "offer",
      ],

      default: "not_applied",

      index: true,
    },

    appliedAt: {
      type: Date,
    },

    /*
     * =====================================================
     * METADATA
     * =====================================================
     */

    processedAt: {
      type: Date,
      default: Date.now,
    },
  },

  {
    timestamps: true,
  },
);

const Job = mongoose.models.Job || mongoose.model("Job", jobSchema);

export default Job;
