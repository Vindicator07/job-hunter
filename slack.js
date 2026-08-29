import { config } from "./config.js";

export async function sendSlackNotification(job, aiResult) {
  const missingSkills =
    Array.isArray(aiResult.missing_skills) && aiResult.missing_skills.length
      ? aiResult.missing_skills.join(", ")
      : "None identified";

  const payload = {
    text: `🚨 *New High-Scoring Job Match!* (Score: ${aiResult.shortlist_score}/10)

*Title:* ${job.title}

*Company:* ${job.company}

*Location:* ${job.location || "Not specified"}

*Posted:* ${
      job.postedAt ? new Date(job.postedAt).toLocaleString("en-IN") : "Unknown"
    }

*Why it's a match:*
${aiResult.match_analysis}

*Missing skills:*
${missingSkills}

*Apply here:*
${job.url}`,
  };

  try {
    const response = await fetch(config.slackWebhook, {
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

    console.log(`✅ Slack notification sent for ${job.title}`);

    return true;
  } catch (error) {
    console.error("❌ Slack webhook failed:", error?.message || error);

    return false;
  }
}
