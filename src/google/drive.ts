import { google } from "googleapis";
import { requireGoogle } from "./auth.js";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink: string;
}

export async function searchDrive(query: string, max = 10): Promise<DriveFile[]> {
  const d = google.drive({ version: "v3", auth: await requireGoogle() });
  const safe = query.replace(/'/g, "\\'");
  const res = await d.files.list({
    q: `fullText contains '${safe}' and trashed = false`,
    pageSize: max,
    fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
    orderBy: "modifiedTime desc",
  });
  return (res.data.files ?? []).map((f) => ({
    id: f.id ?? "",
    name: f.name ?? "",
    mimeType: f.mimeType ?? "",
    modifiedTime: f.modifiedTime ?? "",
    webViewLink: f.webViewLink ?? "",
  }));
}
