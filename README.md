# 🚀 Job Hunter

An automated, AI-powered job discovery and matching system that finds relevant software engineering jobs, filters them by freshness and relevance, evaluates them against a candidate's resume using Google Gemini, stores the results in MongoDB, and sends high-scoring matches to Slack.

---

## ✨ Features

- 🔎 Automated LinkedIn job discovery using Apify
- 📅 Filters jobs to a maximum of 7 days old
- 🎯 Filters jobs based on backend / Node.js / TypeScript relevance
- ♻️ Prevents duplicate jobs from being processed
- 🗄️ Stores jobs and processing state in MongoDB
- 🤖 Evaluates jobs against the candidate's resume using Google Gemini
- 📊 Generates a 1–10 job match score
- 🧠 Identifies matching and missing skills
- 💬 Sends high-scoring matches to Slack
- 🔄 Supports pending jobs when Gemini quota/rate limits are reached
- ⏱️ Designed to run automatically every 6 hours using GitHub Actions
- 📝 Tracks application status independently from AI processing status

---

## 🏗️ Architecture

```text
                        ┌─────────────────┐
                        │  GitHub Actions │
                        │    Every 6 hrs  │
                        └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │    index.js     │
                        │   Orchestrator  │
                        └────────┬────────┘
                                 │
             ┌───────────────────┼───────────────────┐
             │                   │                   │
             ▼                   ▼                   ▼
       ┌───────────┐       ┌─────────────┐     ┌─────────────┐
       │  apify.js │       │jobFilter.js │     │jobService.js│
       │  Scraping │       │   Filters   │     │   MongoDB   │
       └─────┬─────┘       └─────────────┘     └──────┬──────┘
             │                                         │
             ▼                                         ▼
       LinkedIn Jobs                                MongoDB
             │
             └──────────────────┐
                                ▼
                         ┌─────────────┐
                         │  gemini.js  │
                         │  AI Scoring │
                         └──────┬──────┘
                                │
                                ▼
                         ┌─────────────┐
                         │  slack.js   │
                         │ Notification│
                         └─────────────┘
```

---

## 📁 Project Structure

```text
job-hunter/
│
├── index.js
├── config.js
├── constants.js
├── resume.js
├── Job.js
├── jobService.js
├── apify.js
├── jobFilter.js
├── gemini.js
├── slack.js
├── utils.js
│
├── package.json
├── package-lock.json
├── .env
├── .env.example
├── .gitignore
├── README.md
│
└── .github/
    └── workflows/
        └── job-hunter.yml
```

---

## 🧩 File Responsibilities

### `index.js`

Main application orchestrator.

Responsible for coordinating:

```text
Pending jobs
    ↓
Apify scraping
    ↓
Local filtering
    ↓
MongoDB
    ↓
Gemini evaluation
    ↓
Save results
    ↓
Slack notification
```

The file intentionally contains very little implementation logic.

---

### `config.js`

Loads and validates environment variables.

Handles:

- Apify token
- Gemini API key
- Gemini model
- MongoDB URI
- Slack webhook
- Slack score threshold

---

### `constants.js`

Contains application-level constants such as:

- Maximum job age
- AI batch size
- Jobs per search
- LinkedIn search terms
- Apify actor

---

### `resume.js`

Contains the candidate resume used by Gemini during job evaluation.

Keeping the resume separate makes it easy to update without touching the AI logic.

---

### `Job.js`

Contains the Mongoose schema and model.

The database tracks three independent areas.

#### AI processing

```text
pending
processing
completed
failed
```

#### Application

```text
not_applied
ready_to_apply
applied
rejected
interview
offer
```

#### Slack

```text
slackNotified
slackNotifiedAt
```

This separation prevents AI processing state from being confused with application state.

---

### `jobService.js`

Contains MongoDB operations.

Responsibilities include:

- Fetching pending jobs
- Saving new jobs
- Preventing duplicates
- Marking jobs as processing
- Returning jobs to pending
- Marking jobs as failed
- Saving Gemini results
- Updating application status

---

### `apify.js`

Handles job scraping through Apify.

Responsibilities:

- Building LinkedIn search URLs
- Running the Apify actor
- Fetching dataset results
- Normalizing Apify's job format
- Extracting job dates
- Deduplicating jobs within a run

---

### `jobFilter.js`

Contains local job filtering logic.

This happens **before Gemini** to reduce unnecessary AI API usage.

Current filters include:

- Maximum 7-day job age
- Backend relevance
- Node.js relevance
- TypeScript relevance
- NestJS relevance
- Full-stack relevance
- Software engineering relevance
- Exclusion of unrelated technologies and roles

---

### `gemini.js`

Handles Google Gemini integration.

Gemini receives:

```text
Candidate Resume
       +
Job Description
       ↓
Google Gemini
       ↓
Match Score
Match Analysis
Missing Skills
```

The model is configurable through:

```text
GEMINI_MODEL
```

Default:

```text
gemini-2.5-flash
```

---

### `slack.js`

Handles Slack notifications through an Incoming Webhook.

Jobs meeting the configured score threshold are sent to Slack.

Default threshold:

```text
7/10
```

---

### `utils.js`

Contains reusable helper functions such as:

- Text normalization
- Company normalization
- Job title normalization
- Duplicate key generation
- Sleep helper

---

## 🛠️ Technology Stack

| Technology | Purpose |
|---|---|
| Node.js | Runtime |
| JavaScript / ES Modules | Application code |
| Apify | LinkedIn job scraping |
| Google Gemini | AI job evaluation |
| MongoDB | Job storage |
| Mongoose | MongoDB ODM |
| Slack Webhooks | Job notifications |
| dotenv | Environment configuration |
| GitHub Actions | Automated execution |

---

## 🔄 Job Processing Flow

### 1. Discover Jobs

Apify searches LinkedIn using configured search terms.

Example:

```text
Node.js Developer
Senior Node.js Developer
Backend Engineer Node.js
NestJS Developer
Software Engineer Node.js
```

---

### 2. Freshness Filter

Only jobs posted within the configured period are considered.

Current maximum:

```text
7 days
```

This prevents old LinkedIn listings from being sent to Gemini.

---

### 3. Relevance Filter

Jobs are filtered based on the candidate's target profile.

Relevant technologies include:

```text
Node.js
TypeScript
NestJS
Express.js
MongoDB
PostgreSQL
Redis
AWS
Microservices
REST
GraphQL
```

---

### 4. Duplicate Detection

Jobs are checked using:

```text
Job ID
```

and a normalized:

```text
Company + Job Title
```

combination.

This prevents the same job from being repeatedly processed.

---

### 5. MongoDB Queue

New jobs are initially stored as:

```text
aiStatus = pending
```

This creates a persistent processing queue.

If Gemini is unavailable, jobs are not lost.

---

### 6. Gemini Evaluation

A controlled batch of jobs is sent to Gemini.

Gemini returns:

```json
{
  "index": 0,
  "shortlist_score": 8,
  "match_analysis": "Strong backend match...",
  "missing_skills": [
    "Kubernetes"
  ]
}
```

---

### 7. Store AI Results

The database is updated with:

```text
score
analysis
missingSkills
aiStatus
aiProcessedAt
```

---

### 8. Slack Notification

Only jobs meeting the configured score threshold are sent to Slack.

Default:

```text
Score >= 7
```

---

## 🤖 Gemini Quota Protection

The application does not send unlimited jobs to Gemini.

The AI batch size is controlled through:

```text
MAX_AI_BATCH_SIZE
```

If Gemini returns a quota or rate-limit error:

```text
processing
    ↓
Gemini quota error
    ↓
pending
```

The jobs remain available for a future run.

This prevents jobs from being permanently lost because of a temporary Gemini limit.

---

## 🗄️ MongoDB Job Lifecycle

```text
                 New Job
                    │
                    ▼
                pending
                    │
                    ▼
               processing
                /       \
               /         \
              ▼           ▼
        completed       failed
              │
              ▼
       ready_to_apply
```

Application status is independent:

```text
not_applied
     │
     ▼
ready_to_apply
     │
     ▼
applied
     │
     ├──► interview
     │
     ├──► offer
     │
     └──► rejected
```

---

## 🔐 Environment Variables

Create a `.env` file:

```env
APIFY_TOKEN=your_apify_token

GEMINI_API_KEY=your_gemini_api_key

GEMINI_MODEL=gemini-2.5-flash

MONGODB_URI=your_mongodb_connection_string

WEBHOOK_URL=your_slack_webhook_url

```

### Never commit `.env`

Make sure `.gitignore` contains:

```gitignore
node_modules/
.env
.env.local
.DS_Store
```

---

## 🚀 Installation

Clone the repository:

```bash
git clone <your-repository-url>
cd job-hunter
```

Install dependencies:

```bash
npm install
```

---

## ▶️ Run Locally

### Development

```bash
npm run dev
```

The project uses Node's watch mode:

```text
node --watch index.js
```

Changes to source files automatically restart the application.

### Production-style run

```bash
npm start
```

---

## 🧪 Expected Output

A successful run looks approximately like:

```text
🚀 Starting Job Search Pipeline...
Connected to MongoDB.

🔄 No pending jobs from previous runs.

🔍 Searching LinkedIn: "Node.js Developer"

📥 "Node.js Developer" → 5 jobs

🧹 X unique jobs after current-run deduplication.

📅 Fresh job: Backend Engineer at Example

✅ Passed local filter: Backend Engineer at Example

💾 Saved as pending: Backend Engineer at Example

🤖 X jobs are waiting for AI evaluation.

🎯 Backend Engineer at Example → 9/10

Slack status: 200
Slack response: ok

✅ Slack notification sent for Backend Engineer

✅ Pipeline run complete.

MongoDB connection closed.
```

---

## ⏰ Automated Execution

GitHub Actions runs the pipeline automatically every 6 hours.

Workflow:

```text
GitHub Actions
      │
      ▼
Checkout repository
      │
      ▼
Install dependencies
      │
      ▼
node index.js
      │
      ├── Apify
      ├── MongoDB
      ├── Gemini
      └── Slack
```

The workflow can also be triggered manually using:

```text
GitHub → Actions → Job Hunter → Run workflow
```

---

## 🔑 GitHub Secrets

The following secrets should be configured in the GitHub repository:

```text
APIFY_TOKEN
GEMINI_API_KEY
GEMINI_MODEL
MONGODB_URI
WEBHOOK_URL
```

The GitHub Actions workflow should use these secrets instead of storing credentials in the repository.

---

## 📈 Future Improvements

### Job Search

- More targeted LinkedIn searches
- Multiple locations
- Remote-only filtering
- Salary filtering
- Experience-level filtering
- Company blacklist/whitelist

### AI

- Better structured scoring
- Separate technical and seniority scores
- Resume tailoring
- Cover-letter generation
- Job-specific resume recommendations
- AI explanation of rejection reasons

### Application Tracking

- Application date
- Application URL
- Recruiter information
- Interview stages
- Follow-up reminders
- Application analytics

### Reliability

- Retry policies
- Exponential backoff
- Better job queue management
- Dead-letter jobs
- Monitoring and alerting
- Execution metrics

### Dashboard

A future web dashboard could provide:

```text
Jobs discovered
Jobs shortlisted
Average score
Applications
Interviews
Offers
Companies
Skills frequently requested
```

---

## ⚠️ Important

This project is currently designed to:

1. Discover jobs
2. Filter jobs
3. Evaluate jobs with AI
4. Notify about strong matches
5. Track application status

AI scoring should be treated as decision support rather than a guarantee that a job is suitable.

Application automation should be implemented carefully and should respect the terms and policies of the job platform being used.

---

## 👨‍💻 Author

**Mayank Mishra**

Senior Software Engineer

### Core Skills

```text
Node.js
TypeScript
NestJS
React
MongoDB
PostgreSQL
AWS
Distributed Systems
AI-powered Backend Systems
```