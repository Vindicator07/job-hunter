import dotenv from "dotenv";

dotenv.config();

const requiredVariables = [
  "APIFY_TOKEN",
  "GEMINI_API_KEY",
  "MONGODB_URI",
  "WEBHOOK_URL",
];

for (const variable of requiredVariables) {
  if (!process.env[variable]) {
    throw new Error(`Missing required environment variable: ${variable}`);
  }
}

export const config = {
  apifyToken: process.env.APIFY_TOKEN,

  geminiApiKey: process.env.GEMINI_API_KEY,

  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",

  mongodbUri: process.env.MONGODB_URI,

  slackWebhook: process.env.WEBHOOK_URL,
};
