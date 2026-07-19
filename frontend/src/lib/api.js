import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const client = axios.create({ baseURL: API });

// Folders
export const listFolders = () => client.get("/folders").then((r) => r.data);
export const createFolder = (name) =>
  client.post("/folders", { name }).then((r) => r.data);
export const deleteFolder = (id) =>
  client.delete(`/folders/${id}`).then((r) => r.data);

// PDFs
export const listPdfs = (params = {}) =>
  client.get("/pdfs", { params }).then((r) => r.data);
export const getPdf = (id) => client.get(`/pdfs/${id}`).then((r) => r.data);
export const uploadPdfs = (files, folderId, onProgress) => {
  const fd = new FormData();
  files.forEach((f) => fd.append("files", f));
  if (folderId) fd.append("folder_id", folderId);
  return client
    .post("/pdfs/upload", fd, {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: (e) => {
        if (onProgress && e.total)
          onProgress(Math.round((e.loaded / e.total) * 100));
      },
    })
    .then((r) => r.data);
};
export const patchPdf = (id, patch) =>
  client.patch(`/pdfs/${id}`, patch).then((r) => r.data);
export const deletePdf = (id) =>
  client.delete(`/pdfs/${id}`).then((r) => r.data);
export const pdfFileUrl = (id) => `${API}/pdfs/${id}/file`;
export const getSummary = (id) =>
  client.get(`/pdfs/${id}/summary`).then((r) => r.data);

// Conversations
export const listConversations = () =>
  client.get("/conversations").then((r) => r.data);
export const createConversation = (body = {}) =>
  client.post("/conversations", body).then((r) => r.data);
export const patchConversation = (id, patch) =>
  client.patch(`/conversations/${id}`, patch).then((r) => r.data);
export const deleteConversation = (id) =>
  client.delete(`/conversations/${id}`).then((r) => r.data);
export const listMessages = (id) =>
  client.get(`/conversations/${id}/messages`).then((r) => r.data);
export const exportConversationUrl = (id) =>
  `${API}/conversations/${id}/export`;

// Search
export const searchPdfs = (q) =>
  client.get(`/search`, { params: { q } }).then((r) => r.data);

// SSE chat — uses fetch to consume the stream
export async function* streamChat({ conversation_id, message, pdf_ids }) {
  const res = await fetch(`${API}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversation_id, message, pdf_ids }),
  });
  if (!res.ok) throw new Error(`Chat error ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let ev = "message";
      let data = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) ev = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (data) {
        try {
          yield { event: ev, data: JSON.parse(data) };
        } catch {
          yield { event: ev, data };
        }
      }
    }
  }
}
