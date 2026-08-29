/* =========================================================
   NORMALIZE TEXT
========================================================= */

export function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* =========================================================
   NORMALIZE COMPANY
========================================================= */

export function normalizeCompany(company = "") {
  return normalizeText(company)
    .replace(/\b(private|pvt|limited|ltd|inc|llc|corp|corporation)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* =========================================================
   NORMALIZE JOB TITLE
========================================================= */

export function normalizeJobTitle(title = "") {
  return normalizeText(title)
    .replace(
      /\b(junior|jr|senior|sr|lead|staff|principal|associate|ii|iii|iv)\b/g,
      " ",
    )
    .replace(/\b(node js|nodejs)\b/g, "nodejs")
    .replace(/\b(nest js|nestjs)\b/g, "nestjs")
    .replace(/\b(full stack|fullstack)\b/g, "fullstack")
    .replace(/\b(back end|back-end)\b/g, "backend")
    .replace(/\s+/g, " ")
    .trim();
}

/* =========================================================
   CREATE DEDUPE KEY
========================================================= */

export function createDedupeKey(title, company) {
  return `${normalizeCompany(company)}::${normalizeJobTitle(title)}`;
}

/* =========================================================
   SLEEP
========================================================= */

export function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
