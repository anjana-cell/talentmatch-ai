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
