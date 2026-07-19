import React from "react";
import { FileText, UploadCloud } from "lucide-react";

export default function EmptyState({ pdfCount, onPickFirst }) {
  return (
    <div
      className="relative h-full w-full flex flex-col items-center justify-center p-12 overflow-hidden"
      data-testid="empty-workspace"
    >
      <div className="grain absolute inset-0" />
      <div className="relative z-10 max-w-md text-center">
        <div className="mx-auto mb-8 h-16 w-16 flex items-center justify-center border border-border rounded-sm bg-surface">
          <FileText className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
        </div>
        <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tight mb-4 leading-[0.95]">
          Interrogate any document.
        </h1>
        <p className="text-base text-muted-foreground leading-relaxed mb-8">
          Drop a PDF into the library on the left. DocuMind extracts, indexes
          and grounds every answer with page-level citations.
        </p>
        {pdfCount > 0 ? (
          <button
            data-testid="empty-open-first-btn"
            onClick={onPickFirst}
            className="inline-flex items-center gap-2 px-4 py-2 border border-border rounded-[4px] hover:bg-accent hover:text-accent-foreground text-sm font-medium transition-colors"
          >
            Open a document
          </button>
        ) : (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 border border-dashed border-border rounded-[4px] text-sm text-muted-foreground">
            <UploadCloud className="h-4 w-4" />
            Upload a PDF to begin
          </div>
        )}
      </div>
    </div>
  );
}
