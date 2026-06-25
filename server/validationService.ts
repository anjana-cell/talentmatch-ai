import { RankingRow, ValidationReport } from "../src/types";

export function validateSubmission(rows: RankingRow[]): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Array.isArray(rows)) {
    return { valid: false, errors: ["Payload is not an array of rows"], warnings };
  }

  if (rows.length !== 100) {
    errors.push(`Row count is ${rows.length}; must be exactly 100.`);
  }

  // Required fields and types
  rows.forEach((r, idx) => {
    if (typeof r.candidate_id !== 'string' || r.candidate_id.trim() === '') {
      errors.push(`Row ${idx+1}: candidate_id is required and must be a non-empty string.`);
    }
    if (!Number.isInteger(r.rank) || r.rank < 1 || r.rank > 100) {
      errors.push(`Row ${idx+1}: rank must be integer between 1 and 100.`);
    }
    if (!Number.isInteger(r.score) || r.score < 0 || r.score > 100) {
      errors.push(`Row ${idx+1}: score must be integer between 0 and 100.`);
    }
    if (typeof r.reasoning !== 'string' || r.reasoning.trim() === '') {
      errors.push(`Row ${idx+1}: reasoning is required and must be a non-empty string.`);
    }
  });

  // Unique ranks
  const rankSet = new Set<number>();
  rows.forEach(r => rankSet.add(r.rank));
  if (rankSet.size !== rows.length) {
    errors.push(`Ranks must be unique across rows. Found ${rows.length - rankSet.size} duplicates.`);
  }

  // Unique candidate IDs
  const idSet = new Set<string>();
  rows.forEach(r => idSet.add(r.candidate_id));
  if (idSet.size !== rows.length) {
    errors.push(`candidate_id values must be unique across rows. Found ${rows.length - idSet.size} duplicates.`);
  }

  // Descending scores by rank order: rank 1 should have >= rank 2, etc.
  const byRank = [...rows].sort((a,b) => a.rank - b.rank);
  for (let i = 0; i < byRank.length - 1; i++) {
    const cur = byRank[i];
    const next = byRank[i+1];
    if (cur.score < next.score) {
      errors.push(`Score at rank ${cur.rank} (${cur.score}) is less than score at rank ${next.rank} (${next.score}). Scores must be descending.`);
      break;
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export default { validateSubmission };
