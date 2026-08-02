import { apiGet } from "./api";

export interface FsListResult {
  path: string;
  parent: string | null;
  entries: string[];
}

export async function fetchFsList(path: string): Promise<FsListResult> {
  const url = new URL("/api/fs/list", window.location.origin || "http://localhost");
  if (path) {
    url.searchParams.set("path", path);
  }
  return apiGet<FsListResult>(url.pathname + url.search);
}
