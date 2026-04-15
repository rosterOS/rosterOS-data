#!/usr/bin/env node
/**
 * Build adp.json from adp.csv
 *
 * Usage:  node scripts/build-adp-json.cjs
 *
 * The daily ADP scraper writes data/adp.csv.  This script converts that
 * CSV into the canonical adp.json format consumed by the Chrome extension.
 *
 * Run this after the scraper finishes, before build-adp-data.cjs.
 */
"use strict";

const fs   = require("fs");
const path = require("path");

const csvPath     = path.join(__dirname, "..", "data", "adp.csv");
const v2JsonPath  = path.join(__dirname, "..", "adp.json");
const uuidPath    = path.join(__dirname, "..", "data", "UUID.csv");

// ── Team full-name → abbreviation mapping ────────────────────────
const FULL_TO_ABBREV = {
  "Arizona Cardinals": "ARI",    "Atlanta Falcons": "ATL",
  "Baltimore Ravens": "BAL",     "Buffalo Bills": "BUF",
  "Carolina Panthers": "CAR",    "Chicago Bears": "CHI",
  "Cincinnati Bengals": "CIN",   "Cleveland Browns": "CLE",
  "Dallas Cowboys": "DAL",       "Denver Broncos": "DEN",
  "Detroit Lions": "DET",        "Green Bay Packers": "GB",
  "Houston Texans": "HOU",       "Indianapolis Colts": "IND",
  "Jacksonville Jaguars": "JAX", "Kansas City Chiefs": "KC",
  "Las Vegas Raiders": "LV",     "Los Angeles Chargers": "LAC",
  "Los Angeles Rams": "LAR",     "Miami Dolphins": "MIA",
  "Minnesota Vikings": "MIN",    "New England Patriots": "NE",
  "New Orleans Saints": "NO",    "New York Giants": "NYG",
  "New York Jets": "NYJ",        "Philadelphia Eagles": "PHI",
  "Pittsburgh Steelers": "PIT",  "San Francisco 49ers": "SF",
  "Seattle Seahawks": "SEA",     "Tampa Bay Buccaneers": "TB",
  "Tennessee Titans": "TEN",     "Washington Commanders": "WAS",
};

// ── Underdog team UUID → abbreviation fallback ────────────────────
// When the CSV has team UUIDs instead of full names (from API scraper),
// this map resolves them to standard abbreviations.
const UUID_TO_ABBREV = {
  "8459772c-695a-5890-afa1-7ec38da17201": "ARI",
  "8699a914-7d44-5a36-b7a6-2063d3ea761f": "ATL",
  "01bfe9d5-f671-57ed-aa60-249fcca9267c": "BAL",
  "0719b253-43db-532e-8b5c-6c12c6c3f951": "BUF",
  "17f3bc4a-e2d6-5dc5-a554-00549ff0139f": "CAR",
  "e8a4678a-ccdb-5f35-be13-aef6e59a5680": "CHI",
  "ab235cf0-a041-5d36-8241-90a90f0dcb5e": "CIN",
  "338ae7df-02ad-5a94-9767-60f511bd55e1": "CLE",
  "26e67e06-664e-50a6-ad7b-c102705fde8b": "DAL",
  "7b3b21be-a209-5dee-a3f7-3fae61f52a1e": "DEN",
  "a8980eb6-327f-5bc5-abf9-de1e944b566d": "DET",
  "a2fadaac-562f-5a7e-bd63-6d88d90c1ac4": "GB",
  "4ab08caa-b79d-598e-82ef-0906a60d2a89": "HOU",
  "f11f1cf1-9933-5203-8181-95020ee64399": "IND",
  "b49b653c-dc7c-516e-b1c2-da1b30d1b1a6": "JAX",
  "a6f458f4-5078-56e4-a839-af96f1191314": "KC",
  "c7b497d4-18b6-522b-abaa-e5c3d24bc021": "LAC",
  "d150534e-6a05-587b-b9e3-50ef86602e20": "LAR",
  "5ce78c37-b02c-52da-9e4f-fcd65b6ccb76": "LV",
  "9153e0a9-da83-5246-ba43-417537f1bcce": "MIA",
  "5af1e185-627e-5345-851d-3c65c5b66614": "MIN",
  "ef876de9-81ac-5e60-af6e-0ca1700f3a51": "NE",
  "530518ed-91db-57c4-9077-27cc0dd9a293": "NO",
  "d40a4380-49a6-5b5f-ab7d-f5393787ed12": "NYG",
  "516ded41-e882-5175-9a00-d0b4c028eb74": "NYJ",
  "de7219e5-92f1-5989-804a-68479055ba42": "PHI",
  "ecc8eb1b-f714-57a6-bcf3-b183dd6c12a8": "PIT",
  "31631011-5902-52f6-ba01-c4c8d8eb3fd9": "SEA",
  "7161e62b-de20-56e2-a300-0dc23637faaa": "SF",
  "1a20f1da-c502-5224-9c4a-bc363174cd21": "TB",
  "f96aa8db-21c2-5b86-b49d-7e64b4eda61d": "TEN",
  "a6d8dc19-daaf-5798-a8f2-df7f9fc9eecd": "WAS",
};

// ── Minimal RFC-4180 CSV row parser ──────────────────────────────
function parseCSVRow(line) {
  if (!line) return [];
  const fields = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let val = "";
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          val += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++; // skip closing quote
          break;
        } else {
          val += line[i++];
        }
      }
      fields.push(val);
      if (line[i] === ",") i++; // skip delimiter
    } else {
      const next = line.indexOf(",", i);
      if (next === -1) {
        fields.push(line.slice(i).trim());
        break;
      }
      fields.push(line.slice(i, next).trim());
      i = next + 1;
    }
  }
  return fields;
}

// ── Main ─────────────────────────────────────────────────────────
const csv = fs.readFileSync(csvPath, "utf8");
const lines = csv.split("\n");

// ── Load UUID.csv for team-name fallback ─────────────────────────
// UUID.csv columns: id,firstName,lastName,slotName,teamName
// When adp.csv has empty team fields (e.g. 4for4 CSV export lacks
// team data), UUID.csv provides the canonical team mapping.
const uuidTeamById = {};
if (fs.existsSync(uuidPath)) {
  const uuidCsv = fs.readFileSync(uuidPath, "utf8");
  const uuidLines = uuidCsv.split("\n");
  for (let i = 1; i < uuidLines.length; i++) {
    const row = parseCSVRow(uuidLines[i]);
    if (row.length < 5 || !row[0]) continue;
    const teamFull = (row[4] || "").trim();
    if (teamFull) {
      uuidTeamById[row[0]] = FULL_TO_ABBREV[teamFull] || teamFull;
    }
  }
}

// CSV header: "id","firstName","lastName","adp","projectedPoints",
//             "positionRank","slotName","teamName","lineupStatus","byeWeek"
const players = [];
for (let i = 1; i < lines.length; i++) {
  const row = parseCSVRow(lines[i]);
  if (row.length < 8) continue;

  const id              = row[0] || "";
  const firstName       = row[1] || "";
  const lastName        = row[2] || "";
  const adp             = row[3];
  const projectedPoints = row[4] || "0";
  const positionRank    = row[5] || "";
  const position        = row[6] || "";
  const teamFull        = row[7] || "";
  const byeWeek         = (row[9] || "").trim();

  // Parse ADP — players with "-" or missing ADP get null (no market data)
  let adpNum = null;
  if (adp && adp !== "-") {
    const parsed = parseFloat(adp);
    if (!Number.isNaN(parsed)) adpNum = parsed;
  }

  const team = FULL_TO_ABBREV[teamFull] || UUID_TO_ABBREV[teamFull] || teamFull || (id && uuidTeamById[id]) || "";
  const name = `${firstName} ${lastName}`.trim();

  // Skip truly malformed rows (no id or no position)
  if (!id || !position) continue;

  players.push({
    id,
    name,
    adp: adpNum,
    projectedPoints: parseFloat(projectedPoints) || 0,
    positionRank,
    position,
    team,
    byeWeek,
  });
}

// Sort by ADP ascending — null ADP players go to the end
players.sort((a, b) => {
  const aAdp = a.adp ?? Infinity;
  const bAdp = b.adp ?? Infinity;
  return aAdp - bAdp;
});

// Write canonical JSON for v2 TypeScript imports
fs.writeFileSync(v2JsonPath, JSON.stringify(players, null, 2) + "\n", "utf8");
console.log("Wrote", v2JsonPath, "(" + players.length + " players)");
