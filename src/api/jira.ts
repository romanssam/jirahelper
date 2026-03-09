import type {
  CompetencyStats,
  DashboardData,
  MetricPoint,
  MonthlyPoint,
  PersonalStats,
  QualityStats,
  SnapshotPoint
} from '../types';

const baseUrl = import.meta.env.DEV ? '/jira' : import.meta.env.VITE_JIRA_BASE_URL;
const email = import.meta.env.VITE_JIRA_USER_EMAIL;
const token = import.meta.env.VITE_JIRA_API_TOKEN;
const authType = (import.meta.env.VITE_JIRA_AUTH_TYPE ?? 'bearer').toLowerCase();
const assignee = import.meta.env.VITE_JIRA_ASSIGNEE ?? import.meta.env.VITE_JIRA_USER_EMAIL;
const reopenedStatuses = (import.meta.env.VITE_JIRA_REOPENED_STATUSES ?? 'Reopened')
  .split(',')
  .map((value: string) => value.trim())
  .filter(Boolean);
const WIP_SNAPSHOT_KEY = 'jira_dashboard_wip_snapshots';
const MAX_CONCURRENCY = 4;
const inFlightByPeriod = new Map<number, Promise<DashboardData>>();
const competencyModel: Array<{ key: string; label: string; keywords: string[] }> = [
  {
    key: 'frontend_architecture',
    label: 'Frontend архитектура',
    keywords: ['architecture', 'архитектур', 'refactor', 'рефактор', 'component', 'компонент', 'ui kit', 'design system']
  },
  {
    key: 'testing_quality',
    label: 'Тестирование и качество',
    keywords: ['test', 'тест', 'qa', 'e2e', 'cypress', 'playwright', 'jest', 'vitest', 'regression', 'регресс']
  },
  {
    key: 'performance',
    label: 'Производительность',
    keywords: ['performance', 'оптимиз', 'lcp', 'cls', 'tbt', 'bundle', 'cache', 'кэш', 'latency']
  },
  {
    key: 'accessibility',
    label: 'Доступность',
    keywords: ['accessibility', 'a11y', 'доступност', 'wcag', 'aria', 'screen reader']
  },
  {
    key: 'product_analytics',
    label: 'Продуктовая аналитика',
    keywords: ['analytics', 'аналитик', 'metric', 'метрик', 'ab test', 'experiment', 'amplitude', 'segment']
  },
  {
    key: 'backend_integration',
    label: 'Интеграция с backend',
    keywords: ['api', 'graphql', 'rest', 'backend', 'бэкенд', 'integration', 'интеграц', 'contract']
  },
  {
    key: 'devops_observability',
    label: 'DevOps и наблюдаемость',
    keywords: ['ci', 'cd', 'pipeline', 'docker', 'kubernetes', 'sentry', 'grafana', 'monitoring', 'логирован']
  },
  {
    key: 'security_privacy',
    label: 'Безопасность',
    keywords: ['security', 'безопасност', 'auth', 'oauth', 'jwt', 'xss', 'csrf', 'permission', 'rbac']
  },
  {
    key: 'incident_support',
    label: 'Инциденты и поддержка',
    keywords: ['hotfix', 'prod', 'incident', 'oncall', 'дежур', 'авар', 'rollback', 'support']
  },
  {
    key: 'leadership_delivery',
    label: 'Лидерство и delivery',
    keywords: ['epic', 'initiative', 'roadmap', 'planning', 'планирован', 'coordination', 'координац', 'mentoring', 'ментор']
  }
];

function getAuthHeader() {
  if (!token) return undefined;
  if (authType === 'bearer') return `Bearer ${token}`;
  if (!email) return undefined;
  return `Basic ${btoa(`${email}:${token}`)}`;
}

function quote(value: string) {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function assigneeCurrentClause() {
  if (!assignee) throw new Error('Не указан VITE_JIRA_USER_EMAIL');
  return `assignee = ${quote(assignee)}`;
}

function assigneeWasClause() {
  if (!assignee) throw new Error('Не указан VITE_JIRA_USER_EMAIL');
  return `assignee WAS ${quote(assignee)}`;
}

function buildJql(parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(' AND ');
}

async function fetchSearch<T = { total?: number; issues?: Array<{ fields?: Record<string, number | null> }> }>(
  jql: string,
  extraParams: Record<string, string> = {}
): Promise<T> {
  if (!baseUrl) {
    throw new Error('Не указан VITE_JIRA_BASE_URL');
  }

  const params = new URLSearchParams({
    jql
  });
  Object.entries(extraParams).forEach(([key, value]) => {
    params.set(key, value);
  });

  const url = `${baseUrl.replace(/\/$/, '')}/rest/api/2/search?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(getAuthHeader() ? { Authorization: getAuthHeader() as string } : {})
    }
  });

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error('JIRA вернула 403. Проверьте токен/тип auth/права на JQL.');
    }
    throw new Error(`Ошибка JIRA ${response.status}: ${response.statusText}`);
  }

  return (await response.json()) as T;
}

async function fetchIssueWorklogPage(issueKey: string, startAt: number, maxResults: number) {
  if (!baseUrl) {
    throw new Error('Не указан VITE_JIRA_BASE_URL');
  }

  const params = new URLSearchParams({
    startAt: String(startAt),
    maxResults: String(maxResults)
  });
  const url = `${baseUrl.replace(/\/$/, '')}/rest/api/2/issue/${encodeURIComponent(issueKey)}/worklog?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(getAuthHeader() ? { Authorization: getAuthHeader() as string } : {})
    }
  });

  if (!response.ok) {
    throw new Error(`Ошибка worklog ${response.status}: ${response.statusText}`);
  }

  return (await response.json()) as {
    total?: number;
    worklogs?: Array<{
      started?: string;
      timeSpentSeconds?: number;
      author?: { emailAddress?: string; name?: string; key?: string; displayName?: string };
    }>;
  };
}

async function fetchTotal(jql: string): Promise<number> {
  try {
    const data = await fetchSearch<{ total?: number }>(jql, { maxResults: '0' });
    return data.total ?? 0;
  } catch (error) {
    // Fail-open mode: one bad JQL must not ломать весь дашборд.
    console.warn('JQL failed, fallback to 0:', jql, error);
    return 0;
  }
}

function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function formatMonthStart(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatMonthLabel(date: Date) {
  return new Intl.DateTimeFormat('ru-RU', { month: 'short', year: 'numeric' }).format(date);
}

function buildMonthBuckets(periodMonths: number): Array<{ start: string; next: string; label: string }> {
  const now = new Date();
  const currentMonth = monthStart(now);
  const buckets: Array<{ start: string; next: string; label: string }> = [];

  for (let offset = periodMonths - 1; offset >= 0; offset -= 1) {
    const start = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - offset, 1);
    const next = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    buckets.push({
      start: formatMonthStart(start),
      next: formatMonthStart(next),
      label: formatMonthLabel(start)
    });
  }

  return buckets;
}

function movingAverage(values: number[], windowSize: number): Array<number | null> {
  return values.map((_, index) => {
    if (index + 1 < windowSize) return null;
    const chunk = values.slice(index + 1 - windowSize, index + 1);
    const avg = chunk.reduce((sum, value) => sum + value, 0) / windowSize;
    return Number(avg.toFixed(2));
  });
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await mapper(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function loadWipSnapshots(): SnapshotPoint[] {
  const raw = localStorage.getItem(WIP_SNAPSHOT_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as SnapshotPoint[];
    return parsed.filter((point) => typeof point?.date === 'string' && Number.isFinite(point?.wip));
  } catch {
    return [];
  }
}

function saveWipSnapshot(todayIso: string, wip: number): SnapshotPoint[] {
  const snapshots = loadWipSnapshots();
  const withoutToday = snapshots.filter((point) => point.date !== todayIso);
  const next = [...withoutToday, { date: todayIso, wip }]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-120);

  localStorage.setItem(WIP_SNAPSHOT_KEY, JSON.stringify(next));
  return next;
}

function flattenText(input: unknown): string {
  if (typeof input === 'string') return input;
  if (!input || typeof input !== 'object') return '';

  const node = input as {
    text?: unknown;
    content?: unknown;
    attrs?: Record<string, unknown>;
  };
  const chunks: string[] = [];

  if (typeof node.text === 'string') chunks.push(node.text);
  if (node.attrs) {
    Object.values(node.attrs).forEach((value) => {
      if (typeof value === 'string') chunks.push(value);
    });
  }
  if (Array.isArray(node.content)) {
    node.content.forEach((child) => {
      const nested = flattenText(child);
      if (nested) chunks.push(nested);
    });
  }

  return chunks.join(' ');
}

function getCompetencyLevel(score: number): 'начальный' | 'рабочий' | 'сильный' | 'эксперт' {
  if (score >= 45) return 'эксперт';
  if (score >= 25) return 'сильный';
  if (score >= 10) return 'рабочий';
  return 'начальный';
}

async function fetchCompetencyStatsYear(): Promise<CompetencyStats> {
  try {
    const pageSize = 50;
    const maxPages = 12;
    const jql = buildJql([assigneeWasClause(), 'resolved >= -365d', 'resolved IS NOT EMPTY']);
    let startAt = 0;
    let page = 0;
    let total = 0;
    const nowMs = Date.now();
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    const issues: Array<{ key: string; summary: string; corpus: string; isRecent: boolean }> = [];

    while (page < maxPages) {
      const payload = await fetchSearch<{
        total?: number;
        issues?: Array<{
          key?: string;
          fields?: {
            summary?: string;
            description?: unknown;
            labels?: string[];
            components?: Array<{ name?: string }>;
            issuetype?: { name?: string };
            priority?: { name?: string };
            resolved?: string;
          };
        }>;
      }>(jql, {
        startAt: String(startAt),
        maxResults: String(pageSize),
        fields: 'summary,description,labels,components,issuetype,priority,resolved'
      });

      const pageIssues = payload.issues ?? [];
      if (page === 0) total = payload.total ?? 0;
      if (!pageIssues.length) break;

      pageIssues.forEach((issue) => {
        const fields = issue.fields ?? {};
        const summary = fields.summary ?? '';
        const description = flattenText(fields.description);
        const labels = (fields.labels ?? []).join(' ');
        const components = (fields.components ?? []).map((component) => component.name ?? '').join(' ');
        const issueType = fields.issuetype?.name ?? '';
        const priority = fields.priority?.name ?? '';
        const resolved = fields.resolved ?? '';
        const resolvedMs = Date.parse(resolved);
        const isRecent = Number.isFinite(resolvedMs) ? nowMs - resolvedMs <= ninetyDaysMs : false;
        issues.push({
          key: issue.key ?? '',
          summary,
          corpus: `${summary} ${description} ${labels} ${components} ${issueType} ${priority}`.toLowerCase(),
          isRecent
        });
      });

      startAt += pageSize;
      page += 1;
      if (issues.length >= total) break;
    }

    const matrix = competencyModel
      .map((model) => {
        let issueCountYear = 0;
        let issueCount90 = 0;
        const sampleIssues: string[] = [];

        issues.forEach((issue) => {
          const matched = model.keywords.some((keyword) => issue.corpus.includes(keyword));
          if (!matched) return;
          issueCountYear += 1;
          if (issue.isRecent) issueCount90 += 1;
          if (sampleIssues.length < 3 && issue.key) sampleIssues.push(`${issue.key}: ${issue.summary}`);
        });

        const score = round2(issueCountYear * 1 + issueCount90 * 1.5);
        return {
          key: model.key,
          label: model.label,
          score,
          level: getCompetencyLevel(score),
          issueCountYear,
          issueCount90,
          sampleIssues
        };
      })
      .sort((a, b) => b.score - a.score);

    const breadth = matrix.filter((item) => item.issueCountYear > 0).length;
    const coveragePercent = competencyModel.length > 0 ? round2((breadth / competencyModel.length) * 100) : 0;

    return {
      analyzedIssuesYear: issues.length,
      breadth,
      coveragePercent,
      matrix
    };
  } catch (error) {
    console.warn('Competency matrix fallback:', error);
    return {
      analyzedIssuesYear: 0,
      breadth: 0,
      coveragePercent: 0,
      matrix: competencyModel.map((item) => ({
        key: item.key,
        label: item.label,
        score: 0,
        level: 'начальный',
        issueCountYear: 0,
        issueCount90: 0,
        sampleIssues: []
      }))
    };
  }
}

async function fetchIssueQualityStats90(): Promise<QualityStats> {
  const pageSize = 100;
  const maxPages = 15;
  const jql = buildJql([assigneeWasClause(), 'resolved >= -90d']);

  let startAt = 0;
  let total = 0;
  let page = 0;
  let collected = 0;
  let sumSpent = 0;
  let sumEstimate = 0;
  let resolvedWithEstimate = 0;
  let noEstimateWithSpent = 0;
  let overrunCount = 0;

  while (page < maxPages) {
    const payload = await fetchSearch<{
      total?: number;
      issues?: Array<{ fields?: { timespent?: number | null; timeoriginalestimate?: number | null } }>;
    }>(jql, {
      startAt: String(startAt),
      maxResults: String(pageSize),
      fields: 'timespent,timeoriginalestimate'
    });

    const issues = payload.issues ?? [];
    if (page === 0) total = payload.total ?? 0;

    issues.forEach((issue) => {
      const fields = issue.fields ?? {};
      const spent = fields.timespent ?? 0;
      const estimate = fields.timeoriginalestimate ?? 0;
      sumSpent += spent;
      sumEstimate += estimate;

      if (estimate > 0) {
        resolvedWithEstimate += 1;
        if (spent > estimate) overrunCount += 1;
      } else if (spent > 0) {
        noEstimateWithSpent += 1;
      }
    });

    collected += issues.length;
    if (!issues.length || collected >= total) break;

    startAt += pageSize;
    page += 1;
  }

  return {
    noEstimateShare: 0,
    overrunShare: 0,
    avgTimespentHours: collected ? round2(sumSpent / collected / 3600) : 0,
    avgEstimatedHours: collected ? round2(sumEstimate / collected / 3600) : 0,
    estimateToFactSpeedPercent: sumSpent > 0 ? round2((sumEstimate / sumSpent) * 100) : 0,
    sampledIssues: collected,
    resolvedWithEstimate,
    noEstimateWithSpent,
    overrunCount
  };
}

function isWorklogByAssignee(
  author: { emailAddress?: string; name?: string; key?: string; displayName?: string } | undefined
): boolean {
  if (!author || !assignee) return false;
  const target = assignee.toLowerCase();
  const variants = [author.emailAddress, author.name, author.key, author.displayName]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return variants.includes(target);
}

function isInCurrentMonthUntilToday(startedIso: string, monthStartIso: string, todayIso: string): boolean {
  const started = startedIso.slice(0, 10);
  return started >= monthStartIso && started <= todayIso;
}

async function fetchCurrentMonthWorklogStats(): Promise<{ loggedHoursCurrentMonth: number; issuesWithWorklogsCurrentMonth: number }> {
  try {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthStartIso = formatMonthStart(start);
    const todayIso = now.toISOString().slice(0, 10);
    const jqlByAssignee = buildJql([
      `worklogAuthor = ${quote(assignee)}`,
      'worklogDate >= startOfMonth()',
      'worklogDate <= now()'
    ]);
    const jqlByCurrentUser = buildJql([
      'worklogAuthor = currentUser()',
      'worklogDate >= startOfMonth()',
      'worklogDate <= now()'
    ]);

    let startAt = 0;
    const pageSize = 50;
    const maxPages = 8;
    let page = 0;
    let totalSeconds = 0;
    let issuesWithLogs = 0;

    let activeJql = jqlByAssignee;
    let switchedToCurrentUser = false;

    while (page < maxPages) {
      const payload = await fetchSearch<{
        total?: number;
        issues?: Array<{
          key?: string;
          fields?: {
            worklog?: {
              total?: number;
              worklogs?: Array<{
                started?: string;
                timeSpentSeconds?: number;
                author?: { emailAddress?: string; name?: string; key?: string; displayName?: string };
              }>;
            };
          };
        }>;
      }>(activeJql, {
        startAt: String(startAt),
        maxResults: String(pageSize),
        fields: 'worklog'
      });

      const issues = payload.issues ?? [];
      if (!issues.length && page === 0 && !switchedToCurrentUser) {
        activeJql = jqlByCurrentUser;
        switchedToCurrentUser = true;
        continue;
      }
      if (!issues.length) break;

      const issueSums = await mapWithConcurrency(issues, 3, async (issue) => {
        const key = issue.key;
        const inlineWorklog = issue.fields?.worklog;
        let worklogs = inlineWorklog?.worklogs ?? [];
        const inlineTotal = inlineWorklog?.total ?? worklogs.length;

        if (key && inlineTotal > worklogs.length) {
          let wlStartAt = 0;
          const wlPageSize = 100;
          const full: typeof worklogs = [];
          while (true) {
            const wlPage = await fetchIssueWorklogPage(key, wlStartAt, wlPageSize);
            const entries = wlPage.worklogs ?? [];
            if (!entries.length) break;
            full.push(...entries);
            wlStartAt += wlPageSize;
            if (full.length >= (wlPage.total ?? full.length)) break;
          }
          worklogs = full;
        }

        const issueSeconds = worklogs
          .filter((entry) => {
            if (!entry.started || !entry.timeSpentSeconds) return false;
            return (
              isWorklogByAssignee(entry.author) &&
              isInCurrentMonthUntilToday(entry.started, monthStartIso, todayIso)
            );
          })
          .reduce((sum, entry) => sum + (entry.timeSpentSeconds ?? 0), 0);

        return issueSeconds;
      });

      issueSums.forEach((issueSeconds) => {
        if (issueSeconds > 0) {
          totalSeconds += issueSeconds;
          issuesWithLogs += 1;
        }
      });

      startAt += pageSize;
      page += 1;
    }

    return {
      loggedHoursCurrentMonth: round2(totalSeconds / 3600),
      issuesWithWorklogsCurrentMonth: issuesWithLogs
    };
  } catch (error) {
    console.warn('Worklog stats fallback to 0:', error);
    return {
      loggedHoursCurrentMonth: 0,
      issuesWithWorklogsCurrentMonth: 0
    };
  }
}

async function buildDashboardData(periodMonths: number): Promise<DashboardData> {
  const metricsPlan: Array<{ key: string; label: string; jql: string }> = [
    { key: 'allCurrent', label: 'Текущие на мне', jql: buildJql([assigneeCurrentClause()]) },
    { key: 'allEver', label: 'Были на мне (история)', jql: buildJql([assigneeWasClause()]) },
    { key: 'doneAll', label: 'Выполненные всего', jql: buildJql([assigneeWasClause(), 'resolved IS NOT EMPTY']) },
    { key: 'throughput30', label: 'Resolved за 30д', jql: buildJql([assigneeWasClause(), 'resolved >= -30d']) },
    { key: 'throughput180', label: 'Resolved за 180д', jql: buildJql([assigneeWasClause(), 'resolved >= -180d']) },
    { key: 'throughput365', label: 'Resolved за 365д', jql: buildJql([assigneeWasClause(), 'resolved >= -365d']) },
    {
      key: 'withEstimate30',
      label: 'Resolved с оценкой за 30д',
      jql: buildJql([assigneeWasClause(), 'resolved >= -30d', 'timeoriginalestimate IS NOT EMPTY'])
    },
    {
      key: 'withEstimate180',
      label: 'Resolved с оценкой за 180д',
      jql: buildJql([assigneeWasClause(), 'resolved >= -180d', 'timeoriginalestimate IS NOT EMPTY'])
    },
    {
      key: 'withEstimate90',
      label: 'Resolved с оценкой за 90д',
      jql: buildJql([assigneeWasClause(), 'resolved >= -90d', 'timeoriginalestimate IS NOT EMPTY'])
    },
    {
      key: 'withEstimate365',
      label: 'Resolved с оценкой за 365д',
      jql: buildJql([assigneeWasClause(), 'resolved >= -365d', 'timeoriginalestimate IS NOT EMPTY'])
    },
    { key: 'throughput90', label: 'Resolved за 90д', jql: buildJql([assigneeWasClause(), 'resolved >= -90d']) },
    {
      key: 'wipNow',
      label: 'WIP сейчас',
      jql: buildJql([assigneeCurrentClause(), 'statusCategory != Done'])
    },
    {
      key: 'wipInProgress',
      label: 'In Progress',
      jql: buildJql([assigneeCurrentClause(), 'statusCategory = "In Progress"'])
    },
    {
      key: 'stale14',
      label: 'Залипшие 14д',
      jql: buildJql([assigneeCurrentClause(), 'statusCategory != Done', 'updated <= -14d'])
    },
    {
      key: 'bugs90',
      label: 'Закрытые баги 90д',
      jql: buildJql(['issuetype = Bug', assigneeWasClause(), 'resolved >= -90d'])
    },
    {
      key: 'reopened90',
      label: 'Переоткрытия 90д',
      jql: buildJql([assigneeWasClause(), `(${reopenedStatuses
        .map((status: string) => `status CHANGED TO ${quote(status)} DURING (-90d, now())`)
        .join(' OR ')})`])
    },
    {
      key: 'fires90',
      label: 'High/Highest 90д',
      jql: buildJql([assigneeWasClause(), 'resolved >= -90d', 'priority IN (Highest, High)'])
    },
    {
      key: 'hotfix90',
      label: 'Hotfix/Prod 90д',
      jql: buildJql([assigneeWasClause(), 'resolved >= -90d', 'labels IN (hotfix, prod)'])
    },
    {
      key: 'closedEpicsYear',
      label: 'Epics за год',
      jql: buildJql(['issuetype = Epic', assigneeWasClause(), 'resolved >= -365d'])
    },
    {
      key: 'substantialYear',
      label: 'Существенные >=8ч за год',
      jql: buildJql([assigneeWasClause(), 'resolved >= -365d', 'timespent >= 28800'])
    },
    {
      key: 'speed6weeks',
      label: 'Resolved за 6 недель',
      jql: buildJql([assigneeWasClause(), 'resolved >= -42d'])
    }
  ];

  const metrics: MetricPoint[] = await mapWithConcurrency(metricsPlan, MAX_CONCURRENCY, async (metric) => ({
      key: metric.key,
      label: metric.label,
      total: await fetchTotal(metric.jql)
    }));

  const metricValue = (key: string) => metrics.find((metric) => metric.key === key)?.total ?? 0;

  const buckets = buildMonthBuckets(periodMonths);
  const monthlyRaw = await mapWithConcurrency(buckets, MAX_CONCURRENCY, async (bucket) => {
      const resolvedJql = buildJql([
        assigneeWasClause(),
        `resolved >= ${quote(bucket.start)}`,
        `resolved < ${quote(bucket.next)}`
      ]);
      const createdJql = buildJql([
        assigneeWasClause(),
        `created >= ${quote(bucket.start)}`,
        `created < ${quote(bucket.next)}`
      ]);
      const bugsJql = buildJql([
        'issuetype = Bug',
        assigneeWasClause(),
        `resolved >= ${quote(bucket.start)}`,
        `resolved < ${quote(bucket.next)}`
      ]);
      const withEstimateJql = buildJql([
        assigneeWasClause(),
        `resolved >= ${quote(bucket.start)}`,
        `resolved < ${quote(bucket.next)}`,
        'timeoriginalestimate IS NOT EMPTY'
      ]);
      const highPriorityJql = buildJql([
        assigneeWasClause(),
        `resolved >= ${quote(bucket.start)}`,
        `resolved < ${quote(bucket.next)}`,
        'priority IN (Highest, High)'
      ]);

      const resolved = await fetchTotal(resolvedJql);
      const created = await fetchTotal(createdJql);
      const bugs = await fetchTotal(bugsJql);
      const withEstimate = await fetchTotal(withEstimateJql);
      const highPriorityResolved = await fetchTotal(highPriorityJql);

      return {
        month: bucket.start.slice(0, 7),
        monthLabel: bucket.label,
        created,
        resolved,
        bugs,
        withEstimate,
        highPriorityResolved
      };
    });

  const resolvedValues = monthlyRaw.map((point) => point.resolved);
  const ma3 = movingAverage(resolvedValues, 3);
  const ma6 = movingAverage(resolvedValues, 6);

  const monthly: MonthlyPoint[] = monthlyRaw.map((point, index) => ({
    ...point,
    estimateCoveragePercent: point.resolved > 0 ? round2((point.withEstimate / point.resolved) * 100) : 0,
    bugSharePercent: point.resolved > 0 ? round2((point.bugs / point.resolved) * 100) : 0,
    urgentSharePercent: point.resolved > 0 ? round2((point.highPriorityResolved / point.resolved) * 100) : 0,
    ma3: ma3[index],
    ma6: ma6[index]
  }));

  const qualityStats = await fetchIssueQualityStats90();
  const throughput90 = metricValue('throughput90');
  const resolvedWithEstimate90 = qualityStats.resolvedWithEstimate;
  const noEstimate90 = qualityStats.noEstimateWithSpent;
  const overrun90 = qualityStats.overrunCount;

  const quality: QualityStats = {
    ...qualityStats,
    noEstimateShare: throughput90 ? round2((noEstimate90 / throughput90) * 100) : 0,
    overrunShare: resolvedWithEstimate90 ? round2((overrun90 / resolvedWithEstimate90) * 100) : 0
  };

  const backlog = metricValue('wipNow');
  const throughputPerWeek30 = round2(metricValue('throughput30') / (30 / 7));
  const throughputPerWeek90 = round2(metricValue('throughput90') / (90 / 7));
  const throughputPerMonth30 = round2(throughputPerWeek30 * 4.345);
  const throughputPerMonth90 = round2(throughputPerWeek90 * 4.345);
  const optimistic = Math.max(throughputPerWeek30, throughputPerWeek90);
  const pessimistic = Math.min(throughputPerWeek30, throughputPerWeek90);
  const median = round2((throughputPerWeek30 + throughputPerWeek90) / 2);

  const lastMa3 = ma3.length ? ma3[ma3.length - 1] : null;
  const lastMa6 = ma6.length ? ma6[ma6.length - 1] : null;
  const recent3 = monthly.slice(-3);
  const hasRecent3 = recent3.length > 0;
  const avgCreated3 = hasRecent3 ? round2(recent3.reduce((sum, row) => sum + row.created, 0) / recent3.length) : null;
  const avgResolved3 = hasRecent3
    ? round2(recent3.reduce((sum, row) => sum + row.resolved, 0) / recent3.length)
    : null;
  const forecastCompletedNextMonth = lastMa3 ?? avgResolved3 ?? throughputPerMonth90;
  const forecastIncomingNextMonth = avgCreated3;
  const forecastBacklogEndNextMonth =
    forecastIncomingNextMonth != null && forecastCompletedNextMonth != null
      ? round2(Math.max(backlog + forecastIncomingNextMonth - forecastCompletedNextMonth, 0))
      : null;
  const loadIndexPercent =
    forecastIncomingNextMonth != null && forecastCompletedNextMonth != null && forecastCompletedNextMonth > 0
      ? round2((forecastIncomingNextMonth / forecastCompletedNextMonth) * 100)
      : null;
  const evaluateBenchmark = (
    completedPerMonth: number
  ): {
    status: 'ниже рабочего диапазона' | 'рабочий диапазон' | 'высокий темп';
    comment: string;
  } => {
    if (completedPerMonth < 10) {
      return {
        status: 'ниже рабочего диапазона',
        comment: 'Темп ниже типичного для одного фронтенд-разработчика на продуктовой разработке.'
      };
    }
    if (completedPerMonth <= 22) {
      return {
        status: 'рабочий диапазон',
        comment: 'Темп выглядит нормальным для одного фронтенд-разработчика при смешанной сложности задач.'
      };
    }
    return {
      status: 'высокий темп',
      comment: 'Темп высокий, проверьте баланс качества, техдолга и долю срочных задач.'
    };
  };
  const makeVolumeAssessment = (
    periodLabel: string,
    completed: number,
    withEstimate: number,
    months: number
  ) => {
    const completedPerMonth = months > 0 ? round2(completed / months) : 0;
    const estimateCoveragePercent = completed > 0 ? round2((withEstimate / completed) * 100) : 0;
    const bench = evaluateBenchmark(completedPerMonth);
    return {
      periodLabel,
      completed,
      withEstimate,
      estimateCoveragePercent,
      completedPerMonth,
      benchmarkStatus: bench.status,
      benchmarkComment: bench.comment
    };
  };
  const volumeAssessment = [
    makeVolumeAssessment('За месяц', metricValue('throughput30'), metricValue('withEstimate30'), 1),
    makeVolumeAssessment('За полгода', metricValue('throughput180'), metricValue('withEstimate180'), 6),
    makeVolumeAssessment('За год', metricValue('throughput365'), metricValue('withEstimate365'), 12)
  ];
  const worklog = await fetchCurrentMonthWorklogStats();
  const competency = await fetchCompetencyStatsYear();
  const bugRate90 = throughput90 > 0 ? (metricValue('bugs90') / throughput90) * 100 : 0;
  const reopenedRate90 = throughput90 > 0 ? (metricValue('reopened90') / throughput90) * 100 : 0;
  const throughput365 = metricValue('throughput365');
  const backlogCurrent = metricValue('wipNow');
  const throughputMomentum30to90Percent =
    throughputPerWeek90 > 0 ? round2((throughputPerWeek30 / throughputPerWeek90) * 100) : 0;
  const wipPressureWeeks = throughputPerWeek90 > 0 ? round2(backlogCurrent / throughputPerWeek90) : 0;
  const personal: PersonalStats = {
    estimateCoverage90Percent:
      throughput90 > 0 ? round2((metricValue('withEstimate90') / throughput90) * 100) : 0,
    urgentLoadShare90Percent: throughput90 > 0 ? round2((metricValue('fires90') / throughput90) * 100) : 0,
    bugShare90Percent: throughput90 > 0 ? round2((metricValue('bugs90') / throughput90) * 100) : 0,
    reopenRate90Percent: throughput90 > 0 ? round2((metricValue('reopened90') / throughput90) * 100) : 0,
    staleShareCurrentPercent: backlogCurrent > 0 ? round2((metricValue('stale14') / backlogCurrent) * 100) : 0,
    executionFocusPercent: backlogCurrent > 0 ? round2((metricValue('wipInProgress') / backlogCurrent) * 100) : 0,
    complexityShareYearPercent: throughput365 > 0 ? round2((metricValue('substantialYear') / throughput365) * 100) : 0,
    initiativeShareYearPercent: throughput365 > 0 ? round2((metricValue('closedEpicsYear') / throughput365) * 100) : 0,
    deliveryStabilityIndex:
      throughputPerWeek90 > 0
        ? round2(clamp(100 - Math.abs((throughputPerWeek30 / throughputPerWeek90) * 100 - 100), 0, 100))
        : 0,
    throughputMomentum30to90Percent,
    wipPressureWeeks,
    competencyBreadth: competency.breadth,
    competencyCoveragePercent: competency.coveragePercent
  };
  const predictabilityScore = round2(
    (clamp(100 - quality.noEstimateShare * 2, 0, 100) +
      clamp(100 - quality.overrunShare * 2, 0, 100) +
      clamp(100 - Math.abs(quality.estimateToFactSpeedPercent - 100) * 1.5, 0, 100)) /
      3
  );
  const qualityScore = round2(
    (clamp(100 - bugRate90 * 3, 0, 100) +
      clamp(100 - reopenedRate90 * 4, 0, 100) +
      clamp((resolvedWithEstimate90 / Math.max(throughput90, 1)) * 100, 0, 100)) /
      3
  );
  const staleRate = backlog > 0 ? (metricValue('stale14') / backlog) * 100 : 0;
  const loadScore = loadIndexPercent == null ? 50 : clamp(110 - Math.abs(loadIndexPercent - 95) * 1.8, 0, 100);
  const flowScore = round2((clamp(100 - staleRate * 2.5, 0, 100) + loadScore) / 2);
  const trendRatio = throughputPerWeek90 > 0 ? (throughputPerWeek30 / throughputPerWeek90) * 100 : 100;
  const trendScore = clamp(100 - Math.abs(trendRatio - 100) * 1.2, 0, 100);
  const etaScore = clamp(100 - (median > 0 ? median * 8 : 100), 0, 100);
  const deliveryScore = round2((trendScore + etaScore) / 2);
  const overallCoreScore = round2((predictabilityScore + qualityScore + flowScore + deliveryScore) / 4);

  const today = new Date().toISOString().slice(0, 10);
  const snapshots = saveWipSnapshot(today, backlog);

  return {
    fetchedAt: new Date().toISOString(),
    periodMonths,
    metrics,
    monthly,
    quality,
    forecast: {
      backlog,
      throughputPerWeek30,
      throughputPerWeek90,
      throughputPerMonth30,
      throughputPerMonth90,
      optimisticEtaWeeks: optimistic > 0 ? round2(backlog / optimistic) : null,
      medianEtaWeeks: median > 0 ? round2(backlog / median) : null,
      pessimisticEtaWeeks: pessimistic > 0 ? round2(backlog / pessimistic) : null,
      forecastNextMonthMa3: lastMa3,
      forecastNextMonthMa6: lastMa6,
      forecastIncomingNextMonth,
      forecastCompletedNextMonth,
      forecastBacklogEndNextMonth,
      loadIndexPercent,
      volumeAssessment
    },
    wipTrend: snapshots
    ,
    worklog,
    characteristics: {
      predictabilityScore,
      qualityScore,
      flowScore,
      deliveryScore,
      overallCoreScore
    },
    personal,
    competency
  };
}

export async function fetchDashboardData(periodMonths: number): Promise<DashboardData> {
  const inFlight = inFlightByPeriod.get(periodMonths);
  if (inFlight) return inFlight;

  const promise = buildDashboardData(periodMonths);
  inFlightByPeriod.set(periodMonths, promise);

  try {
    return await promise;
  } finally {
    inFlightByPeriod.delete(periodMonths);
  }
}
