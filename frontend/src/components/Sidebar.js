import React, { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Sun,
  Moon,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  createFolder,
  deleteConversation as apiDeleteConversation,
  deleteFolder as apiDeleteFolder,
  deletePdf as apiDeletePdf,
  patchConversation,
  patchPdf,
  uploadPdfs,
} from "@/lib/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";

function IconButton({ children, className = "", ...props }) {
  return (
    <button
      className={`h-7 w-7 inline-flex items-center justify-center border border-transparent rounded-[4px] text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export default function Sidebar({
  pdfs,
  conversations,
  activePdfId,
  setActivePdfId,
  activeConversationId,
  setActiveConversationId,
  onNewChat,
  theme,
  toggleTheme,
  selectedPdfIds,
  setSelectedPdfIds,
}) {
  const qc = useQueryClient();
  const [dropOver, setDropOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [query, setQuery] = useState("");
  const [renamingPdfId, setRenamingPdfId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [openFolders, setOpenFolders] = useState({ __root__: true });
  const fileInputRef = useRef(null);

  const uploadMutation = useMutation({
    mutationFn: async (files) => {
      setUploading(true);
      setUploadProgress(0);
      const result = await uploadPdfs(files, null, setUploadProgress);
      return result;
    },
    onSuccess: () => {
      toast.success("PDFs uploaded — indexing in background");
      qc.invalidateQueries({ queryKey: ["pdfs"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Upload failed"),
    onSettled: () => {
      setUploading(false);
      setUploadProgress(0);
    },
  });

  const handleFiles = useCallback(
    (files) => {
      const list = Array.from(files || []).filter((f) =>
        f.name.toLowerCase().endsWith(".pdf")
      );
      if (!list.length) {
        toast.error("Please choose PDF files");
        return;
      }
      uploadMutation.mutate(list);
    },
    [uploadMutation]
  );

  const onDrop = (e) => {
    e.preventDefault();
    setDropOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const filteredPdfs = useMemo(() => {
    if (!query) return pdfs;
    const q = query.toLowerCase();
    return pdfs.filter((p) => p.name.toLowerCase().includes(q));
  }, [pdfs, query]);

  const toggleSelected = (id) => {
    setSelectedPdfIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const commitRename = async (id) => {
    if (!renameValue.trim()) {
      setRenamingPdfId(null);
      return;
    }
    try {
      await patchPdf(id, { name: renameValue.trim() });
      toast.success("Renamed");
      qc.invalidateQueries({ queryKey: ["pdfs"] });
    } catch (e) {
      toast.error("Rename failed");
    }
    setRenamingPdfId(null);
    setRenameValue("");
  };

  const removePdf = async (id) => {
    try {
      await apiDeletePdf(id);
      if (activePdfId === id) setActivePdfId(null);
      qc.invalidateQueries({ queryKey: ["pdfs"] });
      toast.success("Deleted");
    } catch {
      toast.error("Delete failed");
    }
  };

  const removeConv = async (id) => {
    try {
      await apiDeleteConversation(id);
      if (activeConversationId === id) setActiveConversationId(null);
      qc.invalidateQueries({ queryKey: ["conversations"] });
      toast.success("Chat deleted");
    } catch {
      toast.error("Delete failed");
    }
  };

  const renameConv = async (id, curTitle) => {
    const t = prompt("Rename chat:", curTitle);
    if (!t) return;
    await patchConversation(id, { title: t });
    qc.invalidateQueries({ queryKey: ["conversations"] });
  };

  return (
    <aside
      className="h-full bg-surface border-r border-border flex flex-col select-none"
      data-testid="sidebar"
    >
      {/* Brand */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 border border-foreground rounded-[3px] grid place-items-center">
            <span className="mono text-[10px] font-bold">D</span>
          </div>
          <span className="font-display text-base font-bold tracking-tight">
            DocuMind
          </span>
        </div>
        <div className="flex items-center gap-1">
          <IconButton
            data-testid="theme-toggle-btn"
            onClick={toggleTheme}
            title="Toggle theme"
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </IconButton>
        </div>
      </div>

      {/* Search + upload */}
      <div
        className={`p-3 border-b border-border ${dropOver ? "drop-active" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDropOver(true);
        }}
        onDragLeave={() => setDropOver(false)}
        onDrop={onDrop}
        data-testid="pdf-upload-zone"
      >
        <div className="relative mb-2">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            data-testid="pdf-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search library"
            className="h-8 pl-7 text-xs bg-background"
          />
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="application/pdf"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
          data-testid="hidden-file-input"
        />
        <button
          data-testid="upload-pdf-btn"
          onClick={() => fileInputRef.current?.click()}
          className="w-full h-8 inline-flex items-center justify-center gap-2 text-xs border border-dashed border-border hover:border-accent hover:bg-accent/5 rounded-[4px] text-muted-foreground hover:text-accent transition-colors"
        >
          <Upload className="h-3.5 w-3.5" />
          {uploading ? `Uploading… ${uploadProgress}%` : "Drop or select PDFs"}
        </button>
        {uploading && (
          <Progress value={uploadProgress} className="mt-2 h-1" />
        )}
      </div>

      {/* Library */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        <div className="px-3 py-2 flex items-center justify-between text-[11px] uppercase tracking-widest text-muted-foreground">
          <span>Library</span>
          <span className="mono">{pdfs.length}</span>
        </div>
        <div className="flex-1 overflow-auto scroll-thin px-1 pb-2" data-testid="pdf-library">
          {filteredPdfs.length === 0 && !uploading && (
            <div className="mx-3 mt-2 p-4 border border-dashed border-border rounded-[4px] text-xs text-muted-foreground text-center">
              No PDFs yet.
            </div>
          )}
          <ul className="space-y-0.5">
            {filteredPdfs.map((p) => {
              const selected = selectedPdfIds.includes(p.id);
              const active = activePdfId === p.id;
              return (
                <li
                  key={p.id}
                  data-testid={`pdf-item-${p.id}`}
                  className={`group flex items-center gap-2 px-2 py-1.5 mx-1 rounded-[4px] cursor-pointer text-sm border border-transparent ${
                    active
                      ? "bg-secondary border-border"
                      : "hover:bg-secondary/60"
                  }`}
                  onClick={() => setActivePdfId(p.id)}
                >
                  <Checkbox
                    data-testid={`pdf-select-${p.id}`}
                    checked={selected}
                    onCheckedChange={() => toggleSelected(p.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="h-3.5 w-3.5"
                  />
                  <FileText
                    className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground"
                    strokeWidth={1.5}
                  />
                  {renamingPdfId === p.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => commitRename(p.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(p.id);
                        if (e.key === "Escape") setRenamingPdfId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 bg-background border border-border rounded px-1 text-xs h-6"
                      data-testid={`pdf-rename-input-${p.id}`}
                    />
                  ) : (
                    <span className="flex-1 truncate text-xs" title={p.name}>
                      {p.name}
                    </span>
                  )}
                  <StatusDot status={p.status} />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        onClick={(e) => e.stopPropagation()}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                        data-testid={`pdf-menu-${p.id}`}
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingPdfId(p.id);
                          setRenameValue(p.name);
                        }}
                        data-testid={`pdf-rename-${p.id}`}
                      >
                        <Pencil className="h-3.5 w-3.5 mr-2" /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete "${p.name}"?`)) removePdf(p.id);
                        }}
                        className="text-destructive"
                        data-testid={`pdf-delete-${p.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Conversations */}
        <div className="border-t border-border">
          <div className="px-3 pt-3 pb-2 flex items-center justify-between text-[11px] uppercase tracking-widest text-muted-foreground">
            <span>Chats</span>
            <button
              onClick={onNewChat}
              className="inline-flex items-center gap-1 text-[11px] text-foreground hover:text-accent transition-colors"
              data-testid="new-chat-btn"
            >
              <Plus className="h-3 w-3" /> New
            </button>
          </div>
          <div className="max-h-56 overflow-auto scroll-thin px-1 pb-3">
            {conversations.length === 0 && (
              <div className="mx-3 p-3 border border-dashed border-border rounded-[4px] text-[11px] text-muted-foreground text-center">
                Start a chat to see it here.
              </div>
            )}
            <ul className="space-y-0.5">
              {conversations.map((c) => {
                const active = activeConversationId === c.id;
                return (
                  <li
                    key={c.id}
                    data-testid={`conv-item-${c.id}`}
                    className={`group flex items-center gap-2 px-2 py-1.5 mx-1 rounded-[4px] cursor-pointer text-xs border border-transparent ${
                      active
                        ? "bg-secondary border-border"
                        : "hover:bg-secondary/60"
                    }`}
                    onClick={() => setActiveConversationId(c.id)}
                  >
                    <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{c.title}</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          onClick={(e) => e.stopPropagation()}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                          data-testid={`conv-menu-${c.id}`}
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            renameConv(c.id, c.title);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5 mr-2" /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm("Delete this chat?")) removeConv(c.id);
                          }}
                          className="text-destructive"
                          data-testid={`conv-delete-${c.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>

      {/* Footer scope indicator */}
      <div className="border-t border-border p-3 text-[11px] text-muted-foreground">
        {selectedPdfIds.length > 0 ? (
          <div
            className="flex items-center justify-between"
            data-testid="chat-scope-indicator"
          >
            <span>
              Chatting with{" "}
              <span className="text-foreground font-medium">
                {selectedPdfIds.length}
              </span>{" "}
              selected
            </span>
            <button
              onClick={() => setSelectedPdfIds([])}
              className="hover:text-foreground"
              data-testid="clear-selection-btn"
            >
              clear
            </button>
          </div>
        ) : (
          <span>Chatting across all documents</span>
        )}
      </div>
    </aside>
  );
}

function StatusDot({ status }) {
  const map = {
    ready: { c: "bg-emerald-500", t: "Indexed" },
    processing: { c: "bg-amber-400 animate-pulse", t: "Indexing…" },
    uploaded: { c: "bg-amber-400 animate-pulse", t: "Queued" },
    failed: { c: "bg-red-500", t: "Failed" },
  };
  const s = map[status] || map.uploaded;
  return (
    <span
      title={s.t}
      data-testid={`status-dot-${status}`}
      className={`h-1.5 w-1.5 rounded-full ${s.c}`}
    />
  );
}
