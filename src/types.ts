export type WorkHoursStats = {
  totalMonthHours: number;
  elapsedHours: number;
  elapsedWorkingDays: number;
  totalWorkingDays: number;
  completionPercent: number;
};

export type MetricPoint = {
  key: string;
  label: string;
  total: number;
};

export type MonthlyPoint = {
  month: string;
  monthLabel: string;
  created: number;
  resolved: number;
  bugs: number;
  withEstimate: number;
  highPriorityResolved: number;
  estimateCoveragePercent: number;
  bugSharePercent: number;
  urgentSharePercent: number;
  ma3: number | null;
  ma6: number | null;
};

export type QualityStats = {
  noEstimateShare: number;
  overrunShare: number;
  avgTimespentHours: number;
  avgEstimatedHours: number;
  estimateToFactSpeedPercent: number;
  sampledIssues: number;
  resolvedWithEstimate: number;
  noEstimateWithSpent: number;
  overrunCount: number;
};

export type ForecastStats = {
  backlog: number;
  throughputPerWeek30: number;
  throughputPerWeek90: number;
  throughputPerMonth30: number;
  throughputPerMonth90: number;
  optimisticEtaWeeks: number | null;
  medianEtaWeeks: number | null;
  pessimisticEtaWeeks: number | null;
  forecastNextMonthMa3: number | null;
  forecastNextMonthMa6: number | null;
  forecastIncomingNextMonth: number | null;
  forecastCompletedNextMonth: number | null;
  forecastBacklogEndNextMonth: number | null;
  loadIndexPercent: number | null;
  volumeAssessment: Array<{
    periodLabel: string;
    completed: number;
    withEstimate: number;
    estimateCoveragePercent: number;
    completedPerMonth: number;
    benchmarkStatus: 'ниже рабочего диапазона' | 'рабочий диапазон' | 'высокий темп';
    benchmarkComment: string;
  }>;
};

export type SnapshotPoint = {
  date: string;
  wip: number;
};

export type WorklogStats = {
  loggedHoursCurrentMonth: number;
  issuesWithWorklogsCurrentMonth: number;
};

export type IssueMetricItem = {
  key: string;
  summary: string;
  status?: string;
  project?: string;
  value: number;
  unit: 'days' | 'hours' | 'ratio' | 'count';
};

export type StatusDurationItem = {
  status: string;
  totalDays: number;
  avgDays: number;
  issueCount: number;
};

export type GitLabLinkedIssue = {
  issueKey: string;
  mergeRequests: number;
  merged: number;
  opened: number;
  lastActivityAt: string | null;
};

export type GitLabStats = {
  enabled: boolean;
  baseUrl: string | null;
  scannedMergeRequests: number;
  linkedIssueCount: number;
  linkedIssues: GitLabLinkedIssue[];
  error?: string;
};

export type FlowStats = {
  periodStart: string;
  periodEnd: string;
  sampledIssues: number;
  periodAdded: number;
  periodReopened: number;
  periodChanged: number;
  plannedToClose: number;
  actuallyClosed: number;
  distinctProjects: number;
  distinctComponents: number;
  distinctEpics: number;
  avgInProgressToDoneDays: number | null;
  medianInProgressToDoneDays: number | null;
  avgCreatedToClosedDays: number | null;
  medianCreatedToClosedDays: number | null;
  avgCurrentOpenWorkDays: number | null;
  currentOpenWorkIssues: number;
  statusDurations: StatusDurationItem[];
  reviewQaAcceptanceWaitDays: number | null;
  longContinuousWorkSharePercent: number | null;
  contextSwitchingSharePercent: number | null;
  urgentClosedSharePercent: number | null;
  returnedBackSharePercent: number | null;
  returnedBackCount: number;
  noEstimateWithSpentIssues: IssueMetricItem[];
  topLongest: IssueMetricItem[];
  topOverestimated: IssueMetricItem[];
  topUnderestimated: IssueMetricItem[];
  topStuck: IssueMetricItem[];
  gitlab: GitLabStats;
};

export type CharacteristicsStats = {
  predictabilityScore: number;
  qualityScore: number;
  flowScore: number;
  deliveryScore: number;
  overallCoreScore: number;
  dismissalRiskPercent: number;
};

export type PersonalStats = {
  estimateCoverage90Percent: number;
  urgentLoadShare90Percent: number;
  bugShare90Percent: number;
  reopenRate90Percent: number;
  staleShareCurrentPercent: number;
  executionFocusPercent: number;
  complexityShareYearPercent: number;
  initiativeShareYearPercent: number;
  deliveryStabilityIndex: number;
  throughputMomentum30to90Percent: number;
  wipPressureWeeks: number;
  competencyBreadth: number;
  competencyCoveragePercent: number;
};

export type CompetencyItem = {
  key: string;
  label: string;
  score: number;
  level: 'начальный' | 'рабочий' | 'сильный' | 'эксперт';
  issueCountYear: number;
  issueCount90: number;
  sampleIssues: string[];
};

export type CompetencyStats = {
  analyzedIssuesYear: number;
  coveragePercent: number;
  breadth: number;
  matrix: CompetencyItem[];
};

export type DashboardData = {
  assignee: string;
  fetchedAt: string;
  periodMonths: number;
  metrics: MetricPoint[];
  monthly: MonthlyPoint[];
  quality: QualityStats;
  forecast: ForecastStats;
  wipTrend: SnapshotPoint[];
  worklog: WorklogStats;
  flow: FlowStats;
  characteristics: CharacteristicsStats;
  personal: PersonalStats;
  competency: CompetencyStats;
};

export type AiAssessment = {
  overallStatus: 'хорошо' | 'нормально' | 'риск';
  summary: string;
  strengths: string[];
  risks: string[];
  actions: string[];
};
