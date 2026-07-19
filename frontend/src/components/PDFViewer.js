import React, { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import { pdfFileUrl, getSummary } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

export default function PDFViewer({ pdf, pageJump }) {
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1.0);
  const [width, setWidth] = useState(700);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const containerRef = useRef(null);
  const pagesRef = useRef({});

  const url = useMemo(() => pdfFileUrl(pdf.id), [pdf.id]);

  useEffect(() => {
    // Reset when PDF changes
    setPage(1);
    setNumPages(0);
    setSummary("");
    setSummaryOpen(false);
  }, [pdf.id]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = e.contentRect.width;
        setWidth(Math.max(320, w - 48));
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Jump to page whenever pageJump.tick changes
  useEffect(() => {
    if (!pageJump.page) return;
    setPage(pageJump.page);
    const el = pagesRef.current[pageJump.page];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("pdf-highlight");
      setTimeout(() => el.classList.remove("pdf-highlight"), 1800);
    }
    // eslint-disable-next-line
  }, [pageJump.tick]);

  const generateSummary = async () => {
    if (pdf.status !== "ready") {
      toast.error("Document is still processing. Try again in a moment.");
      return;
    }
    setSummaryOpen(true);
    if (summary) return;
    setSummaryLoading(true);
    try {
      const res = await getSummary(pdf.id);
      setSummary(res.summary);
    } catch (e) {
      toast.error("Summary failed");
      setSummaryOpen(false);
    }
    setSummaryLoading(false);
  };

  const changeZoom = (delta) => setZoom((z) => Math.max(0.5, Math.min(2.4, +(z + delta).toFixed(2))));

  return (
    <div className="h-full flex flex-col" data-testid="pdf-viewer">
      {/* Toolbar */}
      <div className="h-14 border-b border-border flex items-center justify-between px-4 bg-surface flex-shrink-0">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Reader
          </div>
          <div className="text-sm font-medium truncate max-w-[24rem]" title={pdf.name}>
            {pdf.name}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            data-testid="zoom-out-btn"
            onClick={() => changeZoom(-0.1)}
            className="h-8 w-8 border border-border rounded-[4px] flex items-center justify-center hover:bg-secondary transition-colors"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="mono text-xs w-11 text-center text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <button
            data-testid="zoom-in-btn"
            onClick={() => changeZoom(0.1)}
            className="h-8 w-8 border border-border rounded-[4px] flex items-center justify-center hover:bg-secondary transition-colors"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <span className="mx-2 h-5 w-px bg-border" />
          <button
            data-testid="summary-btn"
            onClick={generateSummary}
            className="h-8 px-3 border border-border rounded-[4px] flex items-center gap-1.5 text-xs hover:border-accent hover:text-accent transition-colors"
          >
            <Sparkles className="h-3.5 w-3.5" /> Summary
          </button>
          <a
            data-testid="download-pdf-btn"
            href={url}
            download={pdf.name}
            className="h-8 w-8 border border-border rounded-[4px] flex items-center justify-center hover:bg-secondary transition-colors"
            title="Download"
          >
            <Download className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      {/* Document */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto scroll-thin px-6 py-8 bg-background"
        data-testid="pdf-scroll-area"
      >
        {pdf.status !== "ready" && (
          <div className="mb-4 px-3 py-2 rounded-[4px] border border-border bg-secondary/50 text-xs text-muted-foreground flex items-center gap-2" data-testid="pdf-indexing-banner">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Document is being indexed — you can already read while embeddings build.
          </div>
        )}
        <Document
          file={url}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          onLoadError={() => toast.error("Failed to load PDF")}
          loading={
            <div className="flex items-center gap-2 text-muted-foreground py-12">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading document…
            </div>
          }
          className="flex flex-col items-center gap-6"
        >
          {Array.from({ length: numPages }, (_, i) => (
            <div
              key={i + 1}
              ref={(el) => {
                if (el) pagesRef.current[i + 1] = el;
              }}
              className="bg-white shadow-sm border border-border transition-shadow"
              data-testid={`pdf-page-${i + 1}`}
              onFocus={() => setPage(i + 1)}
            >
              <Page
                pageNumber={i + 1}
                width={width}
                scale={zoom}
                renderTextLayer={true}
                renderAnnotationLayer={false}
              />
              <div className="text-center py-2 text-[10px] mono text-muted-foreground border-t border-border bg-secondary/40">
                Page {i + 1} / {numPages}
              </div>
            </div>
          ))}
        </Document>
      </div>

      {/* Bottom pager */}
      <div className="h-11 border-t border-border flex items-center justify-center gap-2 bg-surface flex-shrink-0">
        <button
          onClick={() => {
            const p = Math.max(1, page - 1);
            setPage(p);
            pagesRef.current[p]?.scrollIntoView({ behavior: "smooth" });
          }}
          className="h-7 w-7 border border-border rounded-[4px] flex items-center justify-center hover:bg-secondary"
          data-testid="prev-page-btn"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="mono text-xs text-muted-foreground" data-testid="page-indicator">
          {page} / {numPages || "…"}
        </span>
        <button
          onClick={() => {
            const p = Math.min(numPages || page, page + 1);
            setPage(p);
            pagesRef.current[p]?.scrollIntoView({ behavior: "smooth" });
          }}
          className="h-7 w-7 border border-border rounded-[4px] flex items-center justify-center hover:bg-secondary"
          data-testid="next-page-btn"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        <DialogContent className="max-w-2xl bg-surface" data-testid="summary-dialog">
          <DialogHeader>
            <DialogTitle className="font-display tracking-tight text-2xl">
              Document Summary
            </DialogTitle>
          </DialogHeader>
          {summaryLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8">
              <Loader2 className="h-4 w-4 animate-spin" /> Generating…
            </div>
          ) : (
            <div
              className="md-body text-sm leading-relaxed"
              data-testid="summary-content"
              dangerouslySetInnerHTML={{
                __html: renderSimpleMd(summary || ""),
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function renderSimpleMd(text) {
  // Very small md renderer (headings/bullets/bold)
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const lines = escaped.split("\n");
  const out = [];
  let inUl = false;
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (/^###\s+/.test(l)) {
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      out.push(`<h3>${l.replace(/^###\s+/, "")}</h3>`);
    } else if (/^##\s+/.test(l)) {
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      out.push(`<h2>${l.replace(/^##\s+/, "")}</h2>`);
    } else if (/^-\s+/.test(l)) {
      if (!inUl) {
        out.push("<ul>");
        inUl = true;
      }
      out.push(
        `<li>${l.replace(/^-\s+/, "").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")}</li>`
      );
    } else if (l === "") {
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
    } else {
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      out.push(
        `<p>${l.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")}</p>`
      );
    }
  }
  if (inUl) out.push("</ul>");
  return out.join("\n");
}
