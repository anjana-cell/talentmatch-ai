import { RankingRow } from "../src/types";

function escapeCsv(value: string) {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function serializeCsv(rows: RankingRow[]): string {
  // Header must be exactly: candidate_id,rank,score,reasoning
  const header = ['candidate_id','rank','score','reasoning'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const line = [
      escapeCsv(r.candidate_id),
      String(r.rank),
      String(r.score),
      escapeCsv(r.reasoning)
    ].join(',');
    lines.push(line);
  }
  return lines.join('\n');
}

export default { serializeCsv };
