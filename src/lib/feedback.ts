// 搭配偏好反馈：滚动窗口 20 条，聚合 Top 标签注入 stylist
const KEY = "ai-outfit-preview:style-feedback";
const WINDOW = 20;
const MIN_COUNT = 2;
const TOP_N = 3;

export interface FeedbackEntry {
  styleTags: string[];
  occasion: string;
  vote: 1 | -1;
  ts: number;
}

function load(): FeedbackEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as FeedbackEntry[]) : [];
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry.ts === "number") : [];
  } catch {
    return [];
  }
}

function save(entries: FeedbackEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(-WINDOW)));
  } catch {
    // 配额不足时放弃
  }
}

export function addFeedback(vote: 1 | -1, styleTags: string[], occasion: string) {
  const entries = load();
  entries.push({ styleTags: styleTags.slice(0, 5), occasion, vote, ts: Date.now() });
  save(entries);
}

export function clearFeedback() {
  save([]);
}

function topTags(entries: FeedbackEntry[], vote: 1 | -1) {
  const counter = new Map<string, number>();
  for (const entry of entries) {
    if (entry.vote !== vote) continue;
    for (const tag of entry.styleTags) {
      counter.set(tag, (counter.get(tag) ?? 0) + 1);
    }
  }
  return [...counter.entries()]
    .filter(([, count]) => count >= MIN_COUNT)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N);
}

export function summarizePreference(): { summary: string; version: string } {
  const entries = load();
  const liked = topTags(entries, 1);
  const disliked = topTags(entries, -1);
  const parts: string[] = [];
  if (liked.length) parts.push(`喜欢：${liked.map(([tag, count]) => `${tag}×${count}`).join("、")}`);
  if (disliked.length) parts.push(`不喜欢：${disliked.map(([tag, count]) => `${tag}×${count}`).join("、")}`);
  const summary = parts.join(" | ");
  // djb2
  let hash = 5381;
  for (let index = 0; index < summary.length; index += 1) {
    hash = ((hash << 5) + hash + summary.charCodeAt(index)) >>> 0;
  }
  return { summary, version: hash.toString(36) };
}
