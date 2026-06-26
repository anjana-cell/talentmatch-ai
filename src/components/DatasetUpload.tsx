import React, { useState } from 'react';
import { Upload, FileText } from 'lucide-react';
import { UploadPreview } from '../types';

interface Props {
  onUploaded: (preview: UploadPreview) => void;
}

export default function DatasetUpload({ onUploaded }: Props) {
  const [fileName, setFileName] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File | null) => {
    setError(null);
    if (!file) return;
    setFileName(file.name);
    setLoading(true);
    try {
      const res = await fetch('/api/upload-jsonl', {
        method: 'POST',
        body: file,
      });
      if (!res.ok) {
        const data = await res.json().catch(()=> ({}));
        throw new Error(data.error || 'Upload failed');
      }
      const data = await res.json();
      onUploaded({ importedCount: data.importedCount, validCount: data.importedCount, invalidCount: data.invalidCount, sampleValid: data.sampleValid, sampleInvalid: data.sampleInvalid });
    } catch (err: any) {
      setError(err.message || 'Failed to upload file');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-50 text-indigo-700 p-2 rounded">
            <Upload className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-semibold text-slate-900">Upload candidates.jsonl</h4>
            <p className="text-xs text-slate-500">Upload newline-delimited JSON (Redrob export).</p>
          </div>
        </div>
        <div>
          <label className="cursor-pointer inline-flex items-center bg-slate-900 text-white px-3 py-2 rounded">
            <input type="file" accept=".json,.jsonl,text/plain" className="hidden" onChange={(e)=> handleFile(e.target.files?.[0] ?? null)} />
            <FileText className="w-4 h-4 mr-2" />
            <span className="text-sm font-semibold">Select File</span>
          </label>
        </div>
      </div>

      <div className="mt-3 text-sm">
        {loading && <div className="text-indigo-600">Parsing upload...</div>}
        {error && <div className="text-rose-600">{error}</div>}
        {!loading && !error && fileName && <div className="text-slate-600">Selected: {fileName}</div>}
      </div>
    </div>
  );
}
