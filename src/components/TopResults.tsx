import React, { useState, useMemo } from 'react';
import { RankingRow, ValidationReport } from '../types';

interface Props {
  rows: RankingRow[];
  onValidate: (rows: RankingRow[]) => Promise<ValidationReport>;
  onExport: () => void;
}

export default function TopResults({ rows, onValidate, onExport }: Props) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [validReport, setValidReport] = useState<ValidationReport | null>(null);
  const [validating, setValidating] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => r.candidate_id.toLowerCase().includes(q) || r.reasoning.toLowerCase().includes(q));
  }, [rows, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page-1)*pageSize, page*pageSize);

  const handleValidate = async () => {
    setValidating(true);
    try {
      const report = await onValidate(rows);
      setValidReport(report);
    } catch (err: any) {
      setValidReport({ valid: false, errors: [err.message || 'Validation failed'], warnings: [] });
    } finally {
      setValidating(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Top 100 Results</h3>
        <div className="flex items-center gap-2">
          <input value={search} onChange={e=> { setSearch(e.target.value); setPage(1); }} placeholder="Search candidate id or reasoning" className="text-sm px-2 py-1 border rounded" />
          <button onClick={handleValidate} disabled={validating} className="bg-indigo-600 text-white px-3 py-1 rounded text-sm">{validating? 'Validating...':'Validate'}</button>
          <button onClick={onExport} className="bg-slate-900 text-white px-3 py-1 rounded text-sm">Export CSV</button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="pr-4">Rank</th>
              <th className="pr-4">Candidate ID</th>
              <th className="pr-4">Score</th>
              <th>Reasoning</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr><td colSpan={4} className="py-6 text-center text-slate-400">No results to show.</td></tr>
            )}
            {pageRows.map(r => (
              <tr key={r.candidate_id} className="border-t">
                <td className="py-2 pr-4 font-mono">{r.rank}</td>
                <td className="py-2 pr-4">{r.candidate_id}</td>
                <td className="py-2 pr-4 font-mono">{r.score}</td>
                <td className="py-2">{r.reasoning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
        <div>Showing {Math.min(rows.length, page*pageSize) - (page-1)*pageSize} of {rows.length}</div>
        <div className="flex items-center gap-2">
          <button onClick={()=> setPage(p => Math.max(1, p-1))} disabled={page===1} className="px-2 py-1 border rounded">Prev</button>
          <span>Page {page} / {totalPages}</span>
          <button onClick={()=> setPage(p => Math.min(totalPages, p+1))} disabled={page===totalPages} className="px-2 py-1 border rounded">Next</button>
        </div>
      </div>

      {validReport && (
        <div className={`mt-3 p-3 rounded ${validReport.valid ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
          <div className="font-semibold">Validation: {validReport.valid ? 'PASS' : 'FAIL'}</div>
          {validReport.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs">
              {validReport.errors.map((e,i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
