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

export type CharacteristicsStats = {
  predictabilityScore: number;
  qualityScore: number;
  flowScore: number;
  deliveryScore: number;
  overallCoreScore: number;
};

export type DashboardData = {
  fetchedAt: string;
  periodMonths: number;
  metrics: MetricPoint[];
  monthly: MonthlyPoint[];
  quality: QualityStats;
  forecast: ForecastStats;
  wipTrend: SnapshotPoint[];
  worklog: WorklogStats;
  characteristics: CharacteristicsStats;
};

export type AiAssessment = {
  overallStatus: 'хорошо' | 'нормально' | 'риск';
  summary: string;
  strengths: string[];
  risks: string[];
  actions: string[];
};
