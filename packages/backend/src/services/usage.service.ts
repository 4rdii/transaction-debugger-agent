/** In-memory usage tracking per Telegram user */

interface UsageRecord {
  userId: number;
  username?: string;
  firstName: string;
  totalAnalyses: number;
  totalQuestions: number;
  lastActiveAt: string;
  firstSeenAt: string;
  recentTxHashes: string[]; // last 20
}

const usageMap = new Map<number, UsageRecord>();

export function trackAnalysis(userId: number, firstName: string, username: string | undefined, txHash: string) {
  const existing = usageMap.get(userId);
  if (existing) {
    existing.totalAnalyses++;
    existing.lastActiveAt = new Date().toISOString();
    existing.username = username ?? existing.username;
    existing.firstName = firstName;
    const hashes = existing.recentTxHashes;
    if (!hashes.includes(txHash)) {
      hashes.push(txHash);
      if (hashes.length > 20) hashes.shift();
    }
  } else {
    usageMap.set(userId, {
      userId,
      username,
      firstName,
      totalAnalyses: 1,
      totalQuestions: 0,
      lastActiveAt: new Date().toISOString(),
      firstSeenAt: new Date().toISOString(),
      recentTxHashes: [txHash],
    });
  }
}

export function trackQuestion(userId: number, firstName: string, username: string | undefined) {
  const existing = usageMap.get(userId);
  if (existing) {
    existing.totalQuestions++;
    existing.lastActiveAt = new Date().toISOString();
    existing.username = username ?? existing.username;
    existing.firstName = firstName;
  } else {
    usageMap.set(userId, {
      userId,
      username,
      firstName,
      totalAnalyses: 0,
      totalQuestions: 1,
      lastActiveAt: new Date().toISOString(),
      firstSeenAt: new Date().toISOString(),
      recentTxHashes: [],
    });
  }
}

export function getUserUsage(userId: number): UsageRecord | undefined {
  return usageMap.get(userId);
}

export function getAllUsage(): UsageRecord[] {
  return [...usageMap.values()].sort((a, b) => b.totalAnalyses - a.totalAnalyses);
}

export function getUsageStats() {
  const users = getAllUsage();
  return {
    totalUsers: users.length,
    totalAnalyses: users.reduce((sum, u) => sum + u.totalAnalyses, 0),
    totalQuestions: users.reduce((sum, u) => sum + u.totalQuestions, 0),
    users,
  };
}
