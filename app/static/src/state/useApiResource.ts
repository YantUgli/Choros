import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../services/api";

export type Resource<T> =
  | { phase: "loading" }
  | { phase: "ready"; data: T }
  | { phase: "error"; status: number | null; message: string };

export function useApiResource<T>(load: () => Promise<T>): [Resource<T>, () => void] {
  const [res, setRes] = useState<Resource<T>>({ phase: "loading" });
  // Penanda muat-ulang; `load` sengaja tidak masuk dependency karena pemanggil
  // hampir selalu memberi lambda baru tiap render.
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let batal = false;
    setRes({ phase: "loading" });
    load()
      .then((data) => {
        if (!batal) setRes({ phase: "ready", data });
      })
      .catch((e: unknown) => {
        if (batal) return;
        const status = e instanceof ApiError ? e.status : null;
        setRes({ phase: "error", status, message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      batal = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  return [res, reload];
}
