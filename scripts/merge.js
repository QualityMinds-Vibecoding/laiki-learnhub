#!/usr/bin/env node
/**
 * LearnHub merge script
 * Reads all contributions/*.json files, aggregates by topic, writes aggregated/learnhub.json.
 *
 * Head count: distinct topic_tokens active within the last 180 days.
 * Timeline: monthly distinct token counts (raw tokens discarded after counting).
 * Resources: sorted by approval_count descending.
 *
 * Usage: node scripts/merge.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONTRIBUTIONS_DIR = path.join(ROOT, 'contributions');
const TOPICS_FILE = path.join(ROOT, 'topics', 'topics.json');
const OUTPUT_FILE = path.join(ROOT, 'aggregated', 'learnhub.json');

const WINDOW_DAYS = 180;

const now = new Date();
const cutoff = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

// Load canonical topic names
const topicsData = JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8'));
const topicNameMap = {};
for (const t of topicsData.topics) {
  topicNameMap[t.id] = t.name;
}

// Read all contributor files
const files = fs.readdirSync(CONTRIBUTIONS_DIR)
  .filter(f => f.endsWith('.json') && f !== '.gitkeep');

const allEntries = [];
for (const file of files) {
  const raw = fs.readFileSync(path.join(CONTRIBUTIONS_DIR, file), 'utf8');
  const entries = JSON.parse(raw);
  if (Array.isArray(entries)) {
    allEntries.push(...entries);
  }
}

// Group entries by topic
const byTopic = {};
for (const entry of allEntries) {
  if (!byTopic[entry.topic]) byTopic[entry.topic] = [];
  byTopic[entry.topic].push(entry);
}

// Build aggregated topics
const topics = [];
for (const [topicId, entries] of Object.entries(byTopic)) {
  // Head count: distinct tokens within the 180-day rolling window
  const recentTokens = new Set();
  for (const e of entries) {
    if (new Date(e.approved_at) >= cutoff) {
      recentTokens.add(e.topic_token);
    }
  }

  // Timeline: monthly distinct token counts (tokens not stored in output)
  const monthlyTokens = {};
  for (const e of entries) {
    const month = e.approved_at.slice(0, 7); // "YYYY-MM"
    if (!monthlyTokens[month]) monthlyTokens[month] = new Set();
    monthlyTokens[month].add(e.topic_token);
  }
  const timeline = Object.entries(monthlyTokens)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, tokens]) => ({ month, heads: tokens.size }));

  // Resources: aggregate by URL
  const resourceMap = {};
  for (const e of entries) {
    const url = e.resource.url;
    if (!resourceMap[url]) {
      resourceMap[url] = {
        url,
        title: e.resource.title,
        type: e.resource.type,
        language: e.resource.language,
        approval_count: 0,
        first_seen: e.approved_at,
        last_seen: e.approved_at,
      };
    }
    const r = resourceMap[url];
    r.approval_count++;
    if (e.approved_at < r.first_seen) r.first_seen = e.approved_at;
    if (e.approved_at > r.last_seen) r.last_seen = e.approved_at;
  }
  const resources = Object.values(resourceMap)
    .sort((a, b) => b.approval_count - a.approval_count);

  topics.push({
    id: topicId,
    name: topicNameMap[topicId] || topicId,
    head_count: recentTokens.size,
    resource_count: resources.length,
    timeline,
    resources,
  });
}

// Sort topics by head_count descending
topics.sort((a, b) => b.head_count - a.head_count);

const output = {
  generated_at: now.toISOString(),
  topics,
};

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
console.log(
  `Done. ${allEntries.length} entries, ${topics.length} topics → ${OUTPUT_FILE}`
);
