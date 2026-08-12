import { apiGet, apiSend } from "./api";

export interface Project { id: number; name: string; folderPath: string; createdAt: string | null; }
export interface TaskGroup { id: number; projectId: number; name: string; categories: string[]; createdAt: string | null; }
export interface TaskRun { id: number; taskGroupId: number; status: string; createdAt: string | null; finishedAt: string | null; }
export interface RunLaneBranch { taskId: number; status: string | null; tokensRun: number; agent: string | null; }
export interface RunLane { category: string; taskId: number | null; status: string | null; tokensRun: number; tokensAccumulated: number; branches?: RunLaneBranch[] | null; }
export interface TaskRunDetail extends TaskRun { lanes: RunLane[]; }
export interface MdFile { path: string; content: string; }
export interface ArtifactCandidates { finalOutput: string | null; mdFiles: MdFile[]; }

const toProject = (x: any): Project => ({ id: x.id, name: x.name, folderPath: x.folder_path, createdAt: x.created_at });
const toTaskGroup = (x: any): TaskGroup => ({ id: x.id, projectId: x.project_id, name: x.name, categories: x.categories, createdAt: x.created_at });
const toTaskRun = (x: any): TaskRun => ({ id: x.id, taskGroupId: x.task_group_id, status: x.status, createdAt: x.created_at, finishedAt: x.finished_at });
const toRunLaneBranch = (x: any): RunLaneBranch => ({ taskId: x.task_id, status: x.status, tokensRun: x.tokens_run, agent: x.agent ?? null });
const toRunLane = (x: any): RunLane => ({ category: x.category, taskId: x.task_id, status: x.status, tokensRun: x.tokens_run, tokensAccumulated: x.tokens_accumulated, branches: x.branches ? x.branches.map(toRunLaneBranch) : null });

export const fetchProjects = () => apiGet<any[]>("/api/projects").then(res => res.map(toProject));
export const createProject = (name: string, folderPath: string) =>
  apiSend<any>("POST", "/api/projects", { name, folder_path: folderPath }).then(toProject);
export const deleteProject = (id: number) => apiSend<void>("DELETE", `/api/projects/${id}`);

export const fetchTaskGroups = (projectId: number) => apiGet<any[]>(`/api/projects/${projectId}/tasks`).then(res => res.map(toTaskGroup));
export const createTaskGroup = (projectId: number, name: string, categories: string[]) =>
  apiSend<any>("POST", `/api/projects/${projectId}/tasks`, { name, categories }).then(toTaskGroup);
export const deleteTaskGroup = (id: number) => apiSend<void>("DELETE", `/api/tasks-groups/${id}`);

export const createRun = (taskGroupId: number) => apiSend<any>("POST", `/api/task-groups/${taskGroupId}/runs`, {}).then(toTaskRun);
export const fetchRuns = (taskGroupId: number) => apiGet<any[]>(`/api/task-groups/${taskGroupId}/runs`).then(res => res.map(toTaskRun));
export const fetchRunDetail = (runId: number) => apiGet<any>(`/api/task-runs/${runId}`).then(x => ({ ...toTaskRun(x), lanes: (x.lanes || []).map(toRunLane) }));

export interface LaneTask { id: number; status: string; finalOutput: string | null; createdAt: string | null; }
const toLaneTask = (x: any): LaneTask => ({ id: x.id, status: x.status, finalOutput: x.final_output, createdAt: x.created_at });
export const fetchLaneTasks = (runId: number, category: string) =>
  apiGet<any[]>(`/api/task-runs/${runId}/lanes/${encodeURIComponent(category)}/tasks`).then(res => res.map(toLaneTask));

export const fetchArtifactCandidates = (taskId: number) =>
  apiGet<any>(`/api/tasks/${taskId}/artifact-candidates`).then(x => ({ finalOutput: x.final_output, mdFiles: x.md_files || [] }));
export const delegate = (taskId: number, toCategory: string, artifact: string) =>
  apiSend<{ id: number }>("POST", `/api/tasks/${taskId}/delegate`, { to_category: toCategory, artifact, mode: "interactive" });

/** Fan-out (Item C): jalankan satu lane di 2 agent serentak. */
export const fanoutLane = (runId: number, category: string, prompt: string, agentIds: number[], opts?: { allowUnisolated?: boolean; force?: boolean }) =>
  apiSend<any[]>("POST", `/api/task-runs/${runId}/lanes/${encodeURIComponent(category)}/fanout`, {
    prompt, agent_ids: agentIds, allow_unisolated: opts?.allowUnisolated ?? false, force: opts?.force ?? false,
  });

/** Pilih cabang pemenang → cabang lain dibuang; opsional delegasi artifact ke lane berikut. */
export const selectWinner = (taskId: number, toCategory?: string, artifact?: string) =>
  apiSend<{ id: number }>("POST", `/api/tasks/${taskId}/select-winner`, { to_category: toCategory ?? null, artifact: artifact ?? null });
