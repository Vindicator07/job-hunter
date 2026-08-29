import { GoogleGenAI } from "@google/genai";

import { config } from "./config.js";

import { CANDIDATE_RESUME } from "./resume.js";

const ai = new GoogleGenAI({
  apiKey: config.geminiApiKey,
});

export async function evaluateJobsWithGemini(jobs) {
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

    postedAt: job.postedAt,

    description: job.description,
  }));

  const prompt = `
You are an expert technical recruiter evaluating jobs for this candidate.

CANDIDATE RESUME:

${CANDIDATE_RESUME}


JOBS:

${JSON.stringify(jobsForAI)}


Evaluate every job against the candidate.

SCORING:

10 = Exceptional match
9 = Excellent match
8 = Very strong match
7 = Strong match and worth applying
6 = Moderate match
5 = Partial match
4 or below = Weak match


Consider:

- Backend engineering
- Node.js
- TypeScript
- NestJS
- Express.js
- REST APIs
- GraphQL
- MongoDB
- PostgreSQL
- Redis
- AWS
- Microservices
- Distributed systems
- System design
- Authentication
- Authorization
- Event-driven architecture
- Seniority
- Years of experience
- Required technologies


IMPORTANT:

- Do NOT inflate scores.
- Do NOT give 8+ simply because Node.js appears once.
- Missing mandatory skills should reduce the score.
- Optional skills should have less impact.
- Java-only roles should score low.
- Python-only roles should score low.
- .NET-only roles should score low.
- QA/testing roles should score low.
- DevOps-only roles should score low.
- Data-science roles should score low.
- Frontend-only roles should score low.
- Generic software engineering roles should only score highly when responsibilities align with the resume.
- Prefer backend/full-stack roles involving Node.js and TypeScript.
- Consider the candidate's actual 4+ years of experience.
- Never assume experience that is not present.


Return ONLY valid JSON.

Format:

{
  "results": [
    {
      "index": 0,
      "shortlist_score": 8,
      "match_analysis": "Two sentence explanation.",
      "missing_skills": ["skill1", "skill2"]
    }
  ]
}
`;

  try {
    const response = await ai.models.generateContent({
      model: config.geminiModel,

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

    if (!Array.isArray(parsed.results)) {
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
    const message = String(error?.message || error || "").toLowerCase();

    const isQuotaError =
      error?.status === 429 ||
      message.includes("quota") ||
      message.includes("rate limit") ||
      message.includes("resource exhausted") ||
      message.includes("too many requests");

    if (isQuotaError) {
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
