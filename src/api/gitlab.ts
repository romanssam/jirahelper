import type { GitLabStats } from '../types';

const configuredBaseUrl = import.meta.env.VITE_GITLAB_BASE_URL ?? 'https://git.eka.wellsoft.pro';
const baseUrl = import.meta.env.DEV ? '/gitlab' : configuredBaseUrl;
const token = import.meta.env.VITE_GITLAB_TOKEN;
const projectIds: string[] = (import.meta.env.VITE_GITLAB_PROJECT_IDS ?? '')
  .split(',')
  .map((value: string) => value.trim())
  .filter(Boolean);
const maxPages = Number(import.meta.env.VITE_GITLAB_MAX_PAGES ?? 4);

type GitLabMergeRequest = {
  iid?: number;
  title?: string;
  description?: string | null;
  source_branch?: string;
  target_branch?: string;
  state?: string;
  merged_at?: string | null;
  updated_at?: string;
  web_url?: string;
};

function emptyStats(overrides: Partial<GitLabStats> = {}): GitLabStats {
  return {
    enabled: false,
    baseUrl: configuredBaseUrl,
    scannedMergeRequests: 0,
    linkedIssueCount: 0,
    linkedIssues: [],
    ...overrides
  };
}

function getIssueKeyPattern(issueKeys: string[]) {
  const projects = Array.from(new Set(issueKeys.map((key) => key.split('-')[0]).filter(Boolean)));
  if (!projects.length) return null;
  return new RegExp(`\\b(?:${projects.map((project) => project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})-\\d+\\b`, 'gi');
}

async function fetchMergeRequestsPage(path: string, params: URLSearchParams): Promise<GitLabMergeRequest[]> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'PRIVATE-TOKEN': token
    }
  });

  if (!response.ok) {
    throw new Error(`GitLab ${response.status}: ${response.statusText}`);
  }

  return (await response.json()) as GitLabMergeRequest[];
}

async function fetchMergeRequestsForPath(path: string, sinceIso: string): Promise<GitLabMergeRequest[]> {
  const result: GitLabMergeRequest[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const params = new URLSearchParams({
      scope: 'all',
      state: 'all',
      order_by: 'updated_at',
      sort: 'desc',
      updated_after: sinceIso,
      per_page: '100',
      page: String(page)
    });
    const chunk = await fetchMergeRequestsPage(path, params);
    if (!chunk.length) break;
    result.push(...chunk);
    if (chunk.length < 100) break;
  }

  return result;
}

export async function fetchGitLabStats(issueKeys: string[], sinceIso: string): Promise<GitLabStats> {
  if (!token) return emptyStats();

  try {
    const paths: string[] = projectIds.length
      ? projectIds.map((projectId: string) => `/api/v4/projects/${encodeURIComponent(projectId)}/merge_requests`)
      : ['/api/v4/merge_requests'];
    const chunks = await Promise.all(paths.map((path: string) => fetchMergeRequestsForPath(path, sinceIso)));
    const mergeRequests = chunks.flat();
    const knownIssueKeys = new Set(issueKeys);
    const issueKeyPattern = getIssueKeyPattern(issueKeys);
    const byIssue = new Map<
      string,
      { issueKey: string; mergeRequests: number; merged: number; opened: number; lastActivityAt: string | null }
    >();

    if (!issueKeyPattern) {
      return emptyStats({ enabled: true, scannedMergeRequests: mergeRequests.length });
    }

    mergeRequests.forEach((mr) => {
      const corpus = [mr.title, mr.description, mr.source_branch, mr.target_branch].filter(Boolean).join(' ');
      const matches = Array.from(corpus.matchAll(issueKeyPattern)).map((match) => match[0].toUpperCase());
      Array.from(new Set(matches)).forEach((issueKey) => {
        if (!knownIssueKeys.has(issueKey)) return;
        const current =
          byIssue.get(issueKey) ??
          {
            issueKey,
            mergeRequests: 0,
            merged: 0,
            opened: 0,
            lastActivityAt: null
          };
        current.mergeRequests += 1;
        if (mr.state === 'merged' || mr.merged_at) current.merged += 1;
        if (mr.state === 'opened') current.opened += 1;
        if (mr.updated_at && (!current.lastActivityAt || mr.updated_at > current.lastActivityAt)) {
          current.lastActivityAt = mr.updated_at;
        }
        byIssue.set(issueKey, current);
      });
    });

    return {
      enabled: true,
      baseUrl: configuredBaseUrl,
      scannedMergeRequests: mergeRequests.length,
      linkedIssueCount: byIssue.size,
      linkedIssues: Array.from(byIssue.values()).sort((a, b) => b.mergeRequests - a.mergeRequests).slice(0, 20)
    };
  } catch (error) {
    return emptyStats({
      enabled: true,
      error: error instanceof Error ? error.message : 'Не удалось загрузить данные GitLab'
    });
  }
}
