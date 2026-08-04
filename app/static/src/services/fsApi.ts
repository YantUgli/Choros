import { apiGet } from "./api";

export interface FsListResult {
  path: string;
  parent: string | null;
  entries: string[];
}

export async function fetchFsList(path: string): Promise<FsListResult> {
  const params = new URLSearchParams();
  if (path) {
    params.set("path", path);
  }
  const suffix = params.toString() ? `?${params}` : "";
  const url = `/api/fs/list${suffix}`;
  return apiGet<FsListResult>(url);
}
