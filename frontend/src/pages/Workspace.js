import React, { useCallback, useMemo, useState } from "react";
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
} from "react-resizable-panels";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createConversation,
  listConversations,
  listPdfs,
} from "@/lib/api";
import Sidebar from "@/components/Sidebar";
import PDFViewer from "@/components/PDFViewer";
import ChatPanel from "@/components/ChatPanel";
import { useTheme } from "@/lib/useTheme";
import EmptyState from "@/components/EmptyState";

export default function Workspace() {
  const qc = useQueryClient();
  const { theme, toggle } = useTheme();
  const [activePdfId, setActivePdfId] = useState(null);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [pageJump, setPageJump] = useState({ page: null, tick: 0 });
  const [selectedPdfIds, setSelectedPdfIds] = useState([]);

  const pdfs = useQuery({ queryKey: ["pdfs"], queryFn: () => listPdfs() });
  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: listConversations,
  });

  const newConv = useMutation({
    mutationFn: (body) => createConversation(body),
    onSuccess: (c) => {
      setActiveConversationId(c.id);
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  const handleCitationClick = useCallback((c) => {
    if (c.pdf_id && c.pdf_id !== activePdfId) {
      setActivePdfId(c.pdf_id);
    }
    setPageJump({ page: c.page, tick: Date.now() });
  }, [activePdfId]);

  const activePdf = useMemo(
    () => pdfs.data?.find((p) => p.id === activePdfId) || null,
    [pdfs.data, activePdfId]
  );

  const handleNewChat = useCallback(() => {
    newConv.mutate({ pdf_ids: selectedPdfIds });
    toast.success("New chat started");
  }, [newConv, selectedPdfIds]);

  return (
    <div
      className="h-screen w-screen flex bg-background text-foreground overflow-hidden"
      data-testid="workspace-root"
    >
      <PanelGroup direction="horizontal">
        <Panel defaultSize={22} minSize={16} maxSize={32}>
          <Sidebar
            pdfs={pdfs.data || []}
            conversations={conversations.data || []}
            activePdfId={activePdfId}
            setActivePdfId={setActivePdfId}
            activeConversationId={activeConversationId}
            setActiveConversationId={setActiveConversationId}
            onNewChat={handleNewChat}
            theme={theme}
            toggleTheme={toggle}
            selectedPdfIds={selectedPdfIds}
            setSelectedPdfIds={setSelectedPdfIds}
          />
        </Panel>
        <PanelResizeHandle />
        <Panel defaultSize={45} minSize={25}>
          <div className="h-full border-r bg-background">
            {activePdf ? (
              <PDFViewer pdf={activePdf} pageJump={pageJump} />
            ) : (
              <EmptyState
                pdfCount={(pdfs.data || []).length}
                onPickFirst={() => {
                  if (pdfs.data?.length) setActivePdfId(pdfs.data[0].id);
                }}
              />
            )}
          </div>
        </Panel>
        <PanelResizeHandle />
        <Panel defaultSize={33} minSize={22}>
          <ChatPanel
            conversationId={activeConversationId}
            onConversationCreated={(id) => setActiveConversationId(id)}
            onCitationClick={handleCitationClick}
            selectedPdfIds={selectedPdfIds}
            pdfs={pdfs.data || []}
          />
        </Panel>
      </PanelGroup>
    </div>
  );
}
