import React, { useState } from 'react';
import { Upload, FileText, Database } from 'lucide-react';
import { UploadPreview } from '../types';

interface DefaultDatasetResponse {
  totalCandidates: number;
  candidates?: unknown[];
}

interface Props {
  onUploaded: (preview: UploadPreview) => void;
  onDefaultLoaded: (data: DefaultDatasetResponse) => void;
}

export default function DatasetUpload({ onUploaded, onDefaultLoaded }: Props) {
  const [fileName, setFileName] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [defaultLoading, setDefaultLoading] = useState(false);
  const [defaultLoaded, setDefaultLoaded] = useState(false);
  const [defaultTotal, setDefaultTotal] = useState<number | null>(null);
  const [defaultError, setDefaultError] = useState<string | null>(null);

const CHUNK_MIN_SIZE = 4 * 1024 * 1024; // upload in text chunks where possible

  const postChunk = async (uploadId: string, chunkIndex: number, chunkText: string, isFinal: boolean, fileName: string) => {
    const res = await fetch('/api/upload-jsonl', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
        'x-upload-id': uploadId,
        'x-upload-chunk-index': String(chunkIndex),
        'x-upload-final': String(isFinal),
        'x-file-name': fileName,
      },
      body: chunkText,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Upload failed');
    }
    return res.json();
  };

  const blobToText = async (blob: Blob): Promise<string> => {
    const buffer = await blob.arrayBuffer();
    return new TextDecoder().decode(buffer);
  };

  const uploadFileStream = async (file: File) => {
    const uploadId = crypto?.randomUUID?.() ?? `upload-${Date.now()}-${Math.floor(Math.random()*1e9)}`;
    const decoder = new TextDecoder();
    let remainder = '';
    let chunkIndex = 0;
    let finalResponse: any = null;

    if (file.stream && typeof file.stream === 'function') {
      const reader = file.stream().getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        remainder += decoder.decode(value, { stream: true });
        while (remainder.length >= CHUNK_MIN_SIZE) {
          const boundary = remainder.indexOf('\n', CHUNK_MIN_SIZE);
          if (boundary === -1) break;
          const chunkText = remainder.slice(0, boundary + 1);
          remainder = remainder.slice(boundary + 1);
          finalResponse = await postChunk(uploadId, chunkIndex, chunkText, false, file.name);
          chunkIndex += 1;
        }
      }
    } else if (file.slice) {
      let offset = 0;
      while (offset < file.size) {
        const end = Math.min(offset + CHUNK_MIN_SIZE, file.size);
        const chunkBlob = file.slice(offset, end);
        const text = await blobToText(chunkBlob);
        remainder += text;
        while (remainder.length >= CHUNK_MIN_SIZE) {
          const boundary = remainder.indexOf('\n', CHUNK_MIN_SIZE);
          if (boundary === -1) break;
          const chunkText = remainder.slice(0, boundary + 1);
          remainder = remainder.slice(boundary + 1);
          finalResponse = await postChunk(uploadId, chunkIndex, chunkText, false, file.name);
          chunkIndex += 1;
        }
        offset = end;
      }
    } else {
      const fullText = await file.text();
      return await postChunk(uploadId, 0, fullText, true, file.name);
    }

    remainder += decoder.decode();
    if (remainder.length > 0) {
      finalResponse = await postChunk(uploadId, chunkIndex, remainder, true, file.name);
    } else {
      finalResponse = await postChunk(uploadId, chunkIndex, '', true, file.name);
    }

    return finalResponse;
  };

  const handleLoadDefault = async () => {
    setDefaultError(null);
    setDefaultLoaded(false);
    setDefaultLoading(true);
    try {
      const res = await fetch('/api/load-default-dataset', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load default dataset');
      }
      const data = await res.json();
      const total = Number(data.totalCandidates ?? 0);
      setDefaultLoaded(true);
      setDefaultTotal(total);
      onDefaultLoaded({
        totalCandidates: total,
        candidates: Array.isArray(data.candidates) ? data.candidates : undefined,
      });
    } catch (err: any) {
      setDefaultError(err.message || 'Failed to load default dataset');
    } finally {
      setDefaultLoading(false);
    }
  };

  const handleFile = async (file: File | null) => {
    setError(null);
    if (!file) return;
    setFileName(file.name);
    setLoading(true);
    try {
      let responseData: any;
      if (file.stream && typeof file.stream === 'function') {
        responseData = await uploadFileStream(file);
      } else {
        const res = await fetch('/api/upload-jsonl', {
          method: 'POST',
          body: file,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Upload failed');
        }
        responseData = await res.json();
      }
      onUploaded({ importedCount: responseData.importedCount, validCount: responseData.importedCount, invalidCount: responseData.invalidCount, sampleValid: responseData.sampleValid, sampleInvalid: responseData.sampleInvalid });
    } catch (err: any) {
      setError(err.message || 'Failed to upload file');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-indigo-50 via-white to-slate-50 rounded-xl border border-indigo-100 p-4 shadow-xs">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 text-white p-2 rounded-lg shadow-sm">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-semibold text-slate-900">Default Dataset</h4>
              <p className="text-xs text-slate-500">Load the bundled candidates from data/candidates.json.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLoadDefault}
            disabled={defaultLoading}
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-sm transition-colors shrink-0"
          >
            {defaultLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                <span>Loading...</span>
              </>
            ) : (
              <>
                <Database className="w-4 h-4" />
                <span>Load Default Dataset</span>
              </>
            )}
          </button>
        </div>

        <div className="mt-3 text-sm">
          {defaultError && <div className="text-rose-600">{defaultError}</div>}
          {defaultLoaded && !defaultError && (
            <div className="flex items-center gap-2 text-emerald-700 font-semibold">
              <span>✓ Default Dataset Loaded</span>
              <span className="text-slate-500 font-normal">·</span>
              <span className="text-slate-700">{defaultTotal ?? 0} candidates</span>
            </div>
          )}
        </div>
      </div>

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
    </div>
  );
}
