/**
 * Satu pintu untuk semua panggilan HTTP cockpit.
 *
 * Auth: backend mematikan pemeriksaan cookie selama belum ada user ber-password
 * (app/security.py:auth_disabled). Begitu password dipasang, semua panggilan di
 * sini balas 401 — ditandai lewat ApiError.status supaya layar bisa membedakan
 * "belum login" dari "backend mati".
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const API_BASE = "";

export async function apiGet<T>(path: string, base = API_BASE): Promise<T> {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new ApiError(res.status, `GET ${path} → ${res.status}`);
  return (await res.json()) as T;
}

export async function apiSend<T>(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  base = API_BASE,
): Promise<T | null> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, `${method} ${path} → ${res.status}`);
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : null;
}
