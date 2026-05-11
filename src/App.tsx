import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { generateAiAssessment } from './api/ai';
import { fetchDashboardData } from './api/jira';
import type { AiAssessment, DashboardData, IssueMetricItem, MetricPoint, StatusDurationItem } from './types';
import { calculateWorkHours } from './utils/hours';

type View = 'overview' | 'analytics' | 'forecast' | 'compare';
type PdfView = 'overview' | 'analytics';
type ThemePreference = 'system' | 'light' | 'dark';

const themeOptions: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'Системная' },
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Темная' }
];

const periodOptions = [
  { value: 12, label: '1 год' },
  { value: 24, label: '2 года' },
  { value: 60, label: '5 лет' }
];

const jiraUserOptions = [
  'r.samotischuk@wellsoft.pro',
  's.trostnitskiy@wellsoft.pro',
  's.altushkin',
  'a.okosten',
  's.kuznetsov',
  'e.antonov',
  'a.zhuravlev',
  's.koromyslov',
  'g.shusharin'
] as const;

const defaultJiraUser =
  jiraUserOptions.find((user) => user === import.meta.env.VITE_JIRA_ASSIGNEE) ?? jiraUserOptions[0];

const compareMetricOptions = [
  { key: 'throughput30', label: 'Resolved за 30 дней', hint: 'Сколько задач было закрыто за последние 30 дней.' },
  { key: 'throughput90', label: 'Resolved за 90 дней', hint: 'Сколько задач было закрыто за последние 90 дней.' },
  { key: 'wipNow', label: 'Текущий WIP', hint: 'Текущее количество незавершенных задач на сотруднике.' },
  { key: 'stale14', label: 'Залипшие 14д', hint: 'Незавершенные задачи без обновлений дольше 14 дней.' },
  { key: 'bugs90', label: 'Баги за 90 дней', hint: 'Сколько багов было закрыто за последние 90 дней.' },
  { key: 'fires90', label: 'High/Highest за 90 дней', hint: 'Сколько срочных задач с высоким приоритетом было закрыто за 90 дней.' }
] as const;

function formatNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU').format(value);
}

function formatDecimal(value: number | null): string {
  if (value == null) return 'нет данных';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
}

function formatMoney(value: number | null): string {
  if (value == null) return 'нет данных';
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0
  }).format(value);
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

function readStoredValue<T>(key: string, fallback: T, validate?: (value: unknown) => value is T): T {
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (validate) return validate(parsed) ? parsed : fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

function useStoredState<T>(key: string, fallback: T, validate?: (value: unknown) => value is T) {
  const [value, setValue] = useState<T>(() => readStoredValue(key, fallback, validate));

  useEffect(() => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue] as const;
}

function getLoadIndexAssessment(value: number | null): string {
  if (value == null) return 'нет данных';
  if (value < 90) return 'хорошо: входящий поток ниже вашей скорости закрытия';
  if (value <= 110) return 'нормально: поток и скорость закрытия примерно сбалансированы';
  return 'плохо: входящий поток выше скорости закрытия, хвост будет расти';
}

function getEtaAssessment(value: number | null): string {
  if (value == null) return 'нет данных';
  if (value <= 4) return 'хорошо: хвост разгребается быстро';
  if (value <= 8) return 'нормально: рабочий срок разгребания';
  return 'плохо: хвост большой или текущий темп недостаточный';
}

function getMonthCapacityAssessment(value: number | null): string {
  if (value == null) return 'нет данных';
  if (value < 10) return 'ниже нормы для одного фронтенд-разработчика';
  if (value <= 22) return 'нормальный рабочий диапазон для одного фронтенд-разработчика';
  return 'высокий темп: проверьте баланс качества и техдолга';
}

function getEstimateToFactSpeedAssessment(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return 'нет данных';
  if (value < 90) return 'ниже нормы: фактические трудозатраты заметно выше оценок';
  if (value <= 110) return 'нормально: оценки близки к факту';
  return 'выше нормы: оценки с запасом или задачи закрываются быстрее ожиданий';
}

function getHigherIsBetterAssessment(value: number, goodThreshold: number, warnThreshold: number): string {
  if (!Number.isFinite(value) || value <= 0) return 'нет данных';
  if (value >= goodThreshold) return 'хорошо';
  if (value >= warnThreshold) return 'нормально';
  return 'риск';
}

function getLowerIsBetterAssessment(value: number, goodThreshold: number, warnThreshold: number): string {
  if (!Number.isFinite(value)) return 'нет данных';
  if (value <= goodThreshold) return 'хорошо';
  if (value <= warnThreshold) return 'нормально';
  return 'риск';
}

function getWipPressureAssessment(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return 'нет данных';
  if (value <= 2) return 'хорошо';
  if (value <= 4) return 'нормально';
  return 'риск';
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundScore(value: number): number {
  return Number(value.toFixed(2));
}

function getResponsibilityClarityScore(data: DashboardData): number {
  const estimateCoverage = data.personal.estimateCoverage90Percent;
  const focus = metricByKey(data.metrics, 'wipNow') > 0 ? data.personal.executionFocusPercent : 100;
  const staleHealth = clampValue(100 - data.personal.staleShareCurrentPercent, 0, 100);
  const reopenHealth = clampValue(100 - data.personal.reopenRate90Percent * 2, 0, 100);

  return roundScore(estimateCoverage * 0.3 + focus * 0.25 + staleHealth * 0.25 + reopenHealth * 0.2);
}

function getEndToEndOwnershipScore(data: DashboardData): number {
  const stability = data.personal.deliveryStabilityIndex;
  const initiative = clampValue(data.personal.initiativeShareYearPercent * 4, 0, 100);
  const complexity = clampValue(data.personal.complexityShareYearPercent * 2, 0, 100);
  const quality = clampValue(100 - data.personal.reopenRate90Percent * 2, 0, 100);

  return roundScore(stability * 0.35 + initiative * 0.2 + complexity * 0.2 + quality * 0.25);
}

function getContextSwitchingIndex(data: DashboardData): number {
  const activeWork = metricByKey(data.metrics, 'wipInProgress');
  const currentBacklog = metricByKey(data.metrics, 'wipNow');
  const urgentShare = data.personal.urgentLoadShare90Percent;

  return roundScore(activeWork * 1.4 + Math.max(currentBacklog - activeWork, 0) * 0.7 + urgentShare * 0.08);
}

function metricByKey(metrics: MetricPoint[], key: string): number {
  return metrics.find((metric) => metric.key === key)?.total ?? 0;
}

function formatDelta(value: number): string {
  if (value === 0) return '0';
  return `${value > 0 ? '+' : ''}${formatNumber(value)}`;
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'нет данных';
  return `${formatDecimal(value)}%`;
}

function formatMetricItemValue(item: IssueMetricItem): string {
  if (item.unit === 'days') return `${formatDecimal(item.value)} д`;
  if (item.unit === 'hours') return `${formatDecimal(item.value)} ч`;
  if (item.unit === 'ratio') return `x${formatDecimal(item.value)}`;
  return formatNumber(item.value);
}

function getDismissalRiskLabel(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'нет данных';
  if (value < 25) return 'низкий';
  if (value < 50) return 'умеренный';
  if (value < 70) return 'высокий';
  return 'критический';
}

function sumMonthly(data: DashboardData, key: 'created' | 'resolved'): number {
  return data.monthly.reduce((sum, row) => sum + row[key], 0);
}

function averagePerMonth(data: DashboardData, key: 'created' | 'resolved'): number {
  return data.monthly.length > 0 ? Number((sumMonthly(data, key) / data.monthly.length).toFixed(2)) : 0;
}

function conversionPercent(data: DashboardData): number | null {
  const created = sumMonthly(data, 'created');
  const resolved = sumMonthly(data, 'resolved');
  return created > 0 ? Number(((resolved / created) * 100).toFixed(2)) : null;
}

function getCompareNarrative(data: DashboardData, peer: DashboardData): string[] {
  const notes: string[] = [];
  const resolved = sumMonthly(data, 'resolved');
  const peerResolved = sumMonthly(peer, 'resolved');
  const reopen = data.personal.reopenRate90Percent;
  const peerReopen = peer.personal.reopenRate90Percent;
  const stale = metricByKey(data.metrics, 'stale14');
  const worklog = data.worklog.loggedHoursCurrentMonth;
  const peerWorklog = peer.worklog.loggedHoursCurrentMonth;

  if (resolved > peerResolved) {
    notes.push(`выше темп закрытия за период: ${formatNumber(resolved)} против ${formatNumber(peerResolved)}`);
  } else if (resolved < peerResolved) {
    notes.push(`ниже темп закрытия за период: ${formatNumber(resolved)} против ${formatNumber(peerResolved)}`);
  } else {
    notes.push(`паритет по закрытию за период: по ${formatNumber(resolved)} задач`);
  }

  if (reopen < peerReopen) {
    notes.push(`лучше по возвратам за 90 дней: ${formatPercent(reopen)} против ${formatPercent(peerReopen)}`);
  } else if (reopen > peerReopen) {
    notes.push(`хуже по возвратам за 90 дней: ${formatPercent(reopen)} против ${formatPercent(peerReopen)}`);
  }

  if (stale > 0) {
    notes.push(`в хвосте ${formatNumber(stale)} зависших задач старше 14 дней`);
  }

  if (worklog > 0 && peerWorklog > 0) {
    const productivity = resolved / worklog;
    const peerProductivity = peerResolved / peerWorklog;
    if (productivity < peerProductivity * 0.7) {
      notes.push('конвертация часов в закрытие задач заметно ниже, чем у второго сотрудника');
    }
  }

  if (data.characteristics.dismissalRiskPercent >= 50) {
    notes.push(
      `эвристический риск увольнения: ${formatPercent(data.characteristics.dismissalRiskPercent)} (${getDismissalRiskLabel(
        data.characteristics.dismissalRiskPercent
      )})`
    );
  }

  return notes.slice(0, 4);
}

function toCsv(data: DashboardData): string {
  const header = [
    'month',
    'monthLabel',
    'created',
    'resolved',
    'bugs',
    'withEstimate',
    'highPriorityResolved',
    'estimateCoveragePercent',
    'bugSharePercent',
    'urgentSharePercent',
    'ma3',
    'ma6'
  ];
  const rows = data.monthly.map((row) =>
    [
      row.month,
      row.monthLabel,
      row.created,
      row.resolved,
      row.bugs,
      row.withEstimate,
      row.highPriorityResolved,
      row.estimateCoveragePercent,
      row.bugSharePercent,
      row.urgentSharePercent,
      row.ma3 ?? '',
      row.ma6 ?? ''
    ].join(',')
  );
  return [header.join(','), ...rows].join('\n');
}

function triggerDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function exportElementToPdf(params: {
  element: HTMLElement;
  filename: string;
  title: string;
  generatedAt: string;
}) {
  const canvas = await html2canvas(params.element, {
    backgroundColor: '#ffffff',
    scale: 2,
    useCORS: true,
    logging: false
  });

  const imageData = canvas.toDataURL('image/png', 1);
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const headerHeight = 15;
  const contentWidth = pageWidth - margin * 2;
  const imageHeight = (canvas.height * contentWidth) / canvas.width;
  const contentStartY = margin + headerHeight;
  const contentHeight = pageHeight - contentStartY - margin;

  let renderedHeight = 0;
  let pageIndex = 0;
  while (renderedHeight < imageHeight) {
    if (pageIndex > 0) pdf.addPage();
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.text(params.title, margin, margin + 6);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(90, 90, 90);
    pdf.text(`Сформировано: ${params.generatedAt}`, margin, margin + 11);
    pdf.setTextColor(0, 0, 0);

    pdf.addImage(
      imageData,
      'PNG',
      margin,
      contentStartY - renderedHeight,
      contentWidth,
      imageHeight,
      undefined,
      'FAST'
    );

    renderedHeight += contentHeight;
    pageIndex += 1;
  }

  pdf.save(params.filename);
}

function Hint({ text }: { text: string }) {
  return (
    <span className="hint" tabIndex={0} aria-label="Пояснение">
      <span className="hint-badge">i</span>
      <span className="hint-bubble">{text}</span>
    </span>
  );
}

function TitleWithHint({ title, hint }: { title: string; hint?: string }) {
  return (
    <p className="card-title">
      {title}
      {hint ? <Hint text={hint} /> : null}
    </p>
  );
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="state-card loading-card" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
      <span className="loading-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}

function IssueMetricList({ title, items }: { title: string; items: IssueMetricItem[] }) {
  return (
    <div className="metric-list-block">
      <p className="metric-list-title">{title}</p>
      {items.length ? (
        <div className="mini-table">
          {items.slice(0, 8).map((item) => (
            <Fragment key={`${title}-${item.key}`}>
              <div className="mini-cell mini-key">{item.key}</div>
              <div className="mini-cell">{item.summary || 'Без summary'}</div>
              <div className="mini-cell mini-value">{formatMetricItemValue(item)}</div>
            </Fragment>
          ))}
        </div>
      ) : (
        <p className="progress-label">Нет задач по этому признаку.</p>
      )}
    </div>
  );
}

function StatusDurationList({ items }: { items: StatusDurationItem[] }) {
  if (!items.length) {
    return <p className="progress-label">Нет статусов из выбранного списка в текущей выборке.</p>;
  }

  return (
    <div className="mini-table status-duration-table">
      {items.slice(0, 8).map((item) => (
        <Fragment key={item.status}>
          <div className="mini-cell mini-key">{item.status}</div>
          <div className="mini-cell">Всего {formatDecimal(item.totalDays)} д</div>
          <div className="mini-cell mini-value">Среднее {formatDecimal(item.avgDays)} д</div>
        </Fragment>
      ))}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>('overview');
  const [periodMonths, setPeriodMonths] = useStoredState<number>(
    'jira-helper-period-months',
    12,
    (value): value is number => typeof value === 'number' && periodOptions.some((option) => option.value === value)
  );
  const [reloadNonce, setReloadNonce] = useState(0);
  const [selectedAssignee, setSelectedAssignee] = useStoredState<string>(
    'jira-helper-selected-assignee',
    defaultJiraUser,
    (value): value is string => typeof value === 'string' && value.length > 0
  );
  const [compareAssigneeLeft, setCompareAssigneeLeft] = useStoredState<string>(
    'jira-helper-compare-left',
    defaultJiraUser,
    (value): value is string => typeof value === 'string' && value.length > 0
  );
  const [compareAssigneeRight, setCompareAssigneeRight] = useStoredState<string>(
    'jira-helper-compare-right',
    jiraUserOptions[1] ?? defaultJiraUser,
    (value): value is string => typeof value === 'string' && value.length > 0
  );
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparePair, setComparePair] = useState<[DashboardData | null, DashboardData | null]>([null, null]);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [aiAssessment, setAiAssessment] = useState<AiAssessment | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [salaryInput, setSalaryInput] = useStoredState<string>(
    'jira-helper-salary-input',
    '',
    (value): value is string => typeof value === 'string'
  );
  const [overtimeMultiplier, setOvertimeMultiplier] = useStoredState<number>(
    'jira-helper-overtime-multiplier',
    1,
    (value): value is number => typeof value === 'number' && [1, 1.5, 2].includes(value)
  );
  const [pdfExporting, setPdfExporting] = useState<PdfView | null>(null);
  const [themePreference, setThemePreference] = useStoredState<ThemePreference>(
    'jira-helper-theme',
    'system',
    (value): value is ThemePreference => value === 'light' || value === 'dark' || value === 'system'
  );
  const overviewSectionRef = useRef<HTMLElement | null>(null);
  const analyticsSectionRef = useRef<HTMLElement | null>(null);

  const hours = useMemo(() => calculateWorkHours(new Date()), []);

  useEffect(() => {
    const root = document.documentElement;

    function applyTheme() {
      const resolvedTheme =
        themePreference === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : themePreference;
      root.dataset.theme = resolvedTheme;
      root.dataset.themePreference = themePreference;
      root.style.colorScheme = resolvedTheme;
    }

    applyTheme();

    if (themePreference !== 'system') return;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [themePreference]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setAiAssessment(null);
      setAiError(null);

      try {
        const next = await fetchDashboardData(periodMonths, selectedAssignee);
        if (!cancelled) setData(next);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Ошибка загрузки');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [periodMonths, reloadNonce, selectedAssignee]);

  useEffect(() => {
    if (view !== 'compare') return;

    let cancelled = false;

    async function loadComparison() {
      setCompareLoading(true);
      setCompareError(null);

      try {
        const next = await Promise.all([
          fetchDashboardData(periodMonths, compareAssigneeLeft),
          fetchDashboardData(periodMonths, compareAssigneeRight)
        ]);
        if (!cancelled) setComparePair([next[0], next[1]]);
      } catch (err) {
        if (!cancelled) {
          setCompareError(err instanceof Error ? err.message : 'Ошибка загрузки сравнения');
        }
      } finally {
        if (!cancelled) setCompareLoading(false);
      }
    }

    void loadComparison();

    return () => {
      cancelled = true;
    };
  }, [view, periodMonths, reloadNonce, compareAssigneeLeft, compareAssigneeRight]);

  const summaryCards = data
    ? [
        { label: 'Все задачи, которые были на мне', value: metricByKey(data.metrics, 'allEver') },
        { label: 'Все выполненные задачи', value: metricByKey(data.metrics, 'doneAll') },
        { label: 'Текущие задачи', value: metricByKey(data.metrics, 'allCurrent') },
        { label: 'Задачи в работе сейчас', value: metricByKey(data.metrics, 'wipNow') },
        { label: 'Выполнено за 30 дней', value: metricByKey(data.metrics, 'throughput30') },
        { label: 'Выполнено за 90 дней', value: metricByKey(data.metrics, 'throughput90') },
        { label: 'Залипшие 14д', value: metricByKey(data.metrics, 'stale14') },
        { label: 'Высокий и наивысший приоритет за 90 дней', value: metricByKey(data.metrics, 'fires90') },
        { label: 'Хотфиксы и прод-задачи за 90 дней', value: metricByKey(data.metrics, 'hotfix90') },
        { label: 'Закрытые баги 90д', value: metricByKey(data.metrics, 'bugs90') }
      ]
    : [];
  const flowCards = data
    ? [
        {
          label: 'In Progress → Done',
          value: data.flow.avgInProgressToDoneDays,
          suffix: 'д',
          hint: 'Среднее количество календарных дней от первого перехода в In Progress до перехода в Done/закрытия.'
        },
        {
          label: 'Создание → закрытие',
          value: data.flow.avgCreatedToClosedDays,
          suffix: 'д',
          hint: 'Среднее количество календарных дней от created до resolutiondate по закрытым задачам периода.'
        },
        {
          label: 'Открытые уже в работе',
          value: data.flow.avgCurrentOpenWorkDays,
          suffix: 'д',
          hint: 'Средний возраст текущих открытых задач с момента последнего/первого входа в рабочий статус.'
        },
        {
          label: 'Review/QA/acceptance',
          value: data.flow.reviewQaAcceptanceWaitDays,
          suffix: 'д',
          hint: 'Среднее ожидание по статусам review, QA и acceptance из настроенных env-списков.'
        },
        {
          label: 'Длинная работа',
          value: data.flow.longContinuousWorkSharePercent,
          suffix: '%',
          hint: 'Доля задач с worklog-стриком от 2 дней или суммарным worklog от 4 часов в периоде.'
        },
        {
          label: 'Возвраты назад',
          value: data.flow.returnedBackSharePercent,
          suffix: '%',
          hint: 'Доля задач, где был переход из Done/Review/QA обратно в рабочие или reopened-статусы.'
        }
      ]
    : [];
  const loggedHoursCurrentMonth = data?.worklog.loggedHoursCurrentMonth ?? 0;
  const worklogProgressRaw =
    hours.totalMonthHours > 0 ? (loggedHoursCurrentMonth / hours.totalMonthHours) * 100 : 0;
  const worklogProgressBarPercent = Math.min(Math.round(worklogProgressRaw), 100);
  const salary = Number(salaryInput.replace(',', '.'));
  const hasSalary = Number.isFinite(salary) && salary > 0;
  const planHourlyRate = hasSalary ? salary / Math.max(hours.totalMonthHours, 1) : null;
  const earnedBySchedule = hasSalary ? (salary * hours.completionPercent) / 100 : null;
  const earnedByWorklog =
    hasSalary && data ? (planHourlyRate ?? 0) * data.worklog.loggedHoursCurrentMonth : null;
  const earnedTotalWithOvertime = earnedByWorklog != null ? earnedByWorklog * overtimeMultiplier : null;
  const taskCostByForecast =
    hasSalary && data && (data.forecast.forecastCompletedNextMonth ?? 0) > 0
      ? salary / (data.forecast.forecastCompletedNextMonth as number)
      : null;
  const throughput30 = data ? metricByKey(data.metrics, 'throughput30') : 0;
  const throughput90 = data ? metricByKey(data.metrics, 'throughput90') : 0;
  const bugs90 = data ? metricByKey(data.metrics, 'bugs90') : 0;
  const fires90 = data ? metricByKey(data.metrics, 'fires90') : 0;
  const costPerTask30 = hasSalary && throughput30 > 0 ? salary / throughput30 : null;
  const costPerTask90 = hasSalary && throughput90 > 0 ? (salary * 3) / throughput90 : null;
  const bugCost90 = costPerTask90 != null ? costPerTask90 * bugs90 : null;
  const urgentCost90 = costPerTask90 != null ? costPerTask90 * fires90 : null;
  const backlogCostExposure =
    taskCostByForecast != null && data ? taskCostByForecast * data.forecast.backlog : null;
  const moneyGapVsSchedule =
    earnedByWorklog != null && earnedBySchedule != null ? earnedByWorklog - earnedBySchedule : null;
  const overtimeHoursCurrentMonth = Math.max(loggedHoursCurrentMonth - hours.elapsedHours, 0);
  const overtimePremiumCost =
    planHourlyRate != null ? overtimeHoursCurrentMonth * planHourlyRate * Math.max(overtimeMultiplier - 1, 0) : null;
  const finalRating = data?.characteristics.overallCoreScore ?? null;
  const monthlyMoneyTrend = useMemo(
    () =>
      data?.monthly.map((row) => ({
        monthLabel: row.monthLabel,
        costPerTask: hasSalary && row.resolved > 0 ? salary / row.resolved : null,
        bugCost: hasSalary && row.resolved > 0 ? (salary / row.resolved) * row.bugs : null
      })) ?? [],
    [data, hasSalary, salary]
  );
  const competencyRadarData = useMemo(
    () =>
      data?.competency.matrix.slice(0, 6).map((item) => ({
        skill: item.label.length > 20 ? `${item.label.slice(0, 20)}...` : item.label,
        fullLabel: item.label,
        score: item.score
      })) ?? [],
    [data]
  );
  const [compareDataLeft, compareDataRight] = comparePair;
  const compareSummaryCards = useMemo(() => {
    if (!compareDataLeft || !compareDataRight) return [];

    return [
      {
        label: 'Core score',
        hint: 'Средний базовый рейтинг по четырем сигналам Jira: предсказуемость, качество, поток и доставка. Чем выше, тем стабильнее и здоровее процесс.',
        left: compareDataLeft.characteristics.overallCoreScore,
        right: compareDataRight.characteristics.overallCoreScore,
        formatter: formatDecimal
      },
      {
        label: 'Resolved за 90 дней',
        hint: 'Сколько задач было закрыто за последние 90 дней.',
        left: metricByKey(compareDataLeft.metrics, 'throughput90'),
        right: metricByKey(compareDataRight.metrics, 'throughput90'),
        formatter: formatDecimal
      },
      {
        label: 'Текущий WIP',
        hint: 'Текущее количество незавершенных задач на сотруднике.',
        left: metricByKey(compareDataLeft.metrics, 'wipNow'),
        right: metricByKey(compareDataRight.metrics, 'wipNow'),
        formatter: formatDecimal
      },
      {
        label: 'Worklog часов за месяц',
        hint: 'Сколько часов сотрудник списал в Jira worklog в текущем месяце.',
        left: compareDataLeft.worklog.loggedHoursCurrentMonth,
        right: compareDataRight.worklog.loggedHoursCurrentMonth,
        formatter: formatDecimal
      },
      {
        label: 'Ясность ответственности',
        hint: 'Прокси 0-100% для RACI-подобного анализа: есть ли оценки/критерии, сфокусирован ли текущий WIP, нет ли залипаний и переоткрытий.',
        left: getResponsibilityClarityScore(compareDataLeft),
        right: getResponsibilityClarityScore(compareDataRight),
        formatter: formatPercent
      },
      {
        label: 'Риск увольнения',
        hint: 'Эвристический риск-индекс 0-100% по Jira-метрикам: качество, предсказуемость, хвост, переоткрытия и давление WIP. Это не HR-вердикт.',
        left: compareDataLeft.characteristics.dismissalRiskPercent,
        right: compareDataRight.characteristics.dismissalRiskPercent,
        formatter: formatPercent
      }
    ];
  }, [compareDataLeft, compareDataRight]);
  const compareMetricRows = useMemo(() => {
    if (!compareDataLeft || !compareDataRight) return [];

    return compareMetricOptions.map((metric) => {
      const left = metricByKey(compareDataLeft.metrics, metric.key);
      const right = metricByKey(compareDataRight.metrics, metric.key);
      return {
        label: metric.label,
        hint: metric.hint,
        left,
        right,
        delta: left - right
      };
    });
  }, [compareDataLeft, compareDataRight]);
  const compareTrendData = useMemo(() => {
    if (!compareDataLeft || !compareDataRight) return [];

    return compareDataLeft.monthly.map((leftMonth, index) => {
      const rightMonth = compareDataRight.monthly[index];
      return {
        monthLabel: leftMonth.monthLabel,
        leftResolved: leftMonth.resolved,
        rightResolved: rightMonth?.resolved ?? 0,
        leftCreated: leftMonth.created,
        rightCreated: rightMonth?.created ?? 0
      };
    });
  }, [compareDataLeft, compareDataRight]);
  const compareMonthlyRows = useMemo(() => {
    if (!compareDataLeft || !compareDataRight) return [];

    return compareDataLeft.monthly.map((leftMonth, index) => {
      const rightMonth = compareDataRight.monthly[index];
      return {
        monthLabel: leftMonth.monthLabel,
        leftCreated: leftMonth.created,
        leftResolved: leftMonth.resolved,
        rightCreated: rightMonth?.created ?? 0,
        rightResolved: rightMonth?.resolved ?? 0
      };
    });
  }, [compareDataLeft, compareDataRight]);
  const compareSpeedRows = useMemo(() => {
    if (!compareDataLeft || !compareDataRight) return [];

    return [
      {
        label: 'Закрыто за период',
        hint: 'Сумма resolved по всем месяцам выбранного периода.',
        left: sumMonthly(compareDataLeft, 'resolved'),
        right: sumMonthly(compareDataRight, 'resolved'),
        formatter: (value: number | null) => formatNumber(value ?? 0)
      },
      {
        label: 'Среднее закрытие в месяц',
        hint: 'Среднее количество resolved в месяц по текущему периоду.',
        left: averagePerMonth(compareDataLeft, 'resolved'),
        right: averagePerMonth(compareDataRight, 'resolved'),
        formatter: (value: number | null) => formatDecimal(value)
      },
      {
        label: 'Создано за период',
        hint: 'Сумма created по всем месяцам выбранного периода.',
        left: sumMonthly(compareDataLeft, 'created'),
        right: sumMonthly(compareDataRight, 'created'),
        formatter: (value: number | null) => formatNumber(value ?? 0)
      },
      {
        label: 'Конверсия closed/created',
        hint: 'Отношение закрытых задач к созданным в выбранном периоде.',
        left: conversionPercent(compareDataLeft),
        right: conversionPercent(compareDataRight),
        formatter: (value: number | null) => formatPercent(value)
      },
      {
        label: 'Rate переоткрытий 90д',
        hint: 'Доля переоткрытых задач среди закрытых за последние 90 дней.',
        left: compareDataLeft.personal.reopenRate90Percent,
        right: compareDataRight.personal.reopenRate90Percent,
        formatter: (value: number | null) => formatPercent(value)
      },
      {
        label: 'Индекс стабильности delivery',
        hint: 'Насколько темп последних 30 дней близок к базовому темпу 90 дней.',
        left: compareDataLeft.personal.deliveryStabilityIndex,
        right: compareDataRight.personal.deliveryStabilityIndex,
        formatter: (value: number | null) => formatPercent(value)
      }
    ];
  }, [compareDataLeft, compareDataRight]);
  const compareBacklogRows = useMemo(() => {
    if (!compareDataLeft || !compareDataRight) return [];

    return [
      {
        label: 'Открытых незавершённых',
        hint: 'Все текущие задачи в статусах не Done.',
        left: metricByKey(compareDataLeft.metrics, 'wipNow'),
        right: metricByKey(compareDataRight.metrics, 'wipNow'),
        formatter: (value: number | null) => formatNumber(value ?? 0)
      },
      {
        label: 'В работе',
        hint: 'Текущие задачи в статусной категории In Progress.',
        left: metricByKey(compareDataLeft.metrics, 'wipInProgress'),
        right: metricByKey(compareDataRight.metrics, 'wipInProgress'),
        formatter: (value: number | null) => formatNumber(value ?? 0)
      },
      {
        label: 'Зависшие 14д',
        hint: 'Незавершённые задачи без обновлений дольше 14 дней.',
        left: metricByKey(compareDataLeft.metrics, 'stale14'),
        right: metricByKey(compareDataRight.metrics, 'stale14'),
        formatter: (value: number | null) => formatNumber(value ?? 0)
      },
      {
        label: 'Фокус на исполнении',
        hint: 'Доля задач In Progress внутри текущего хвоста.',
        left: compareDataLeft.personal.executionFocusPercent,
        right: compareDataRight.personal.executionFocusPercent,
        formatter: (value: number | null) => formatPercent(value)
      },
      {
        label: 'Давление WIP, недель',
        hint: 'За сколько недель можно разгрести текущий хвост при темпе 90 дней.',
        left: compareDataLeft.personal.wipPressureWeeks,
        right: compareDataRight.personal.wipPressureWeeks,
        formatter: (value: number | null) => formatDecimal(value)
      }
    ];
  }, [compareDataLeft, compareDataRight]);
  const compareResponsibilityRows = useMemo(() => {
    if (!compareDataLeft || !compareDataRight) return [];

    return [
      {
        label: 'Ясность ответственности',
        hint: 'Прокси 0-100%: оцененность задач, фокус текущей работы, отсутствие залипаний и переоткрытий. Чем выше, тем понятнее зона ответственности и критерии результата.',
        left: getResponsibilityClarityScore(compareDataLeft),
        right: getResponsibilityClarityScore(compareDataRight),
        formatter: (value: number | null) => formatPercent(value)
      },
      {
        label: 'Ownership результата end-to-end',
        hint: 'Прокси 0-100%: стабильность доставки, доля инициатив/эпиков, существенные задачи и низкие переоткрытия. Показывает, насколько сотрудник доводит заметный результат от начала до конца.',
        left: getEndToEndOwnershipScore(compareDataLeft),
        right: getEndToEndOwnershipScore(compareDataRight),
        formatter: (value: number | null) => formatPercent(value)
      },
      {
        label: 'Ширина роли',
        hint: 'Количество распознанных компетентностных направлений за год. Помогает увидеть, роль узкая или человек закрывает несколько типов работ.',
        left: compareDataLeft.personal.competencyBreadth,
        right: compareDataRight.personal.competencyBreadth,
        formatter: (value: number | null) => formatNumber(value ?? 0)
      },
      {
        label: 'Покрытие компетенций',
        hint: 'Доля задач за год, которые попали в распознанные компетентностные категории. Чем выше, тем понятнее вклад и рабочий профиль.',
        left: compareDataLeft.personal.competencyCoveragePercent,
        right: compareDataRight.personal.competencyCoveragePercent,
        formatter: (value: number | null) => formatPercent(value)
      },
      {
        label: 'Индекс переключений контекста',
        hint: 'Прокси на основе активного WIP, незавершенного хвоста и срочных задач. Чем выше, тем больше риск распыления и потери фокуса.',
        left: getContextSwitchingIndex(compareDataLeft),
        right: getContextSwitchingIndex(compareDataRight),
        formatter: (value: number | null) => formatDecimal(value)
      },
      {
        label: 'Нагрузка относительно темпа, недель',
        hint: 'Сколько недель нужно, чтобы закрыть текущий хвост при темпе последних 90 дней. Показывает, соответствует ли объем работы возможностям.',
        left: compareDataLeft.personal.wipPressureWeeks,
        right: compareDataRight.personal.wipPressureWeeks,
        formatter: (value: number | null) => formatDecimal(value)
      },
      {
        label: 'Доля залипших задач',
        hint: 'Доля текущего хвоста без обновлений дольше 14 дней. Это сигнал неясного owner, зависимостей или несогласованной работы.',
        left: compareDataLeft.personal.staleShareCurrentPercent,
        right: compareDataRight.personal.staleShareCurrentPercent,
        formatter: (value: number | null) => formatPercent(value)
      }
    ];
  }, [compareDataLeft, compareDataRight]);
  const compareScoreRows = useMemo(() => {
    if (!compareDataLeft || !compareDataRight) return [];

    return [
      {
        label: 'Предсказуемость',
        left: compareDataLeft.characteristics.predictabilityScore,
        right: compareDataRight.characteristics.predictabilityScore,
        formatter: formatDecimal
      },
      {
        label: 'Качество',
        left: compareDataLeft.characteristics.qualityScore,
        right: compareDataRight.characteristics.qualityScore,
        formatter: formatDecimal
      },
      {
        label: 'Поток',
        left: compareDataLeft.characteristics.flowScore,
        right: compareDataRight.characteristics.flowScore,
        formatter: formatDecimal
      },
      {
        label: 'Доставка',
        left: compareDataLeft.characteristics.deliveryScore,
        right: compareDataRight.characteristics.deliveryScore,
        formatter: formatDecimal
      },
      {
        label: 'Компетентностный охват',
        left: compareDataLeft.personal.competencyCoveragePercent,
        right: compareDataRight.personal.competencyCoveragePercent,
        formatter: formatPercent
      },
      {
        label: 'Итоговый core score',
        left: compareDataLeft.characteristics.overallCoreScore,
        right: compareDataRight.characteristics.overallCoreScore,
        formatter: formatDecimal
      },
      {
        label: 'Риск увольнения, %',
        left: compareDataLeft.characteristics.dismissalRiskPercent,
        right: compareDataRight.characteristics.dismissalRiskPercent,
        formatter: formatPercent
      }
    ];
  }, [compareDataLeft, compareDataRight]);
  const compareNarratives = useMemo(() => {
    if (!compareDataLeft || !compareDataRight) return null;

    return {
      left: getCompareNarrative(compareDataLeft, compareDataRight),
      right: getCompareNarrative(compareDataRight, compareDataLeft)
    };
  }, [compareDataLeft, compareDataRight]);

  async function handleAiAssessment() {
    if (!data) return;

    setAiLoading(true);
    setAiError(null);
    try {
      const result = await generateAiAssessment({
        data,
        hours,
        salaryMonth: hasSalary ? salary : null,
        earnedBySchedule,
        earnedByWorklog,
        hourlyRate: planHourlyRate,
        taskCost: taskCostByForecast
      });
      setAiAssessment(result);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Не удалось получить AI-разбор.');
    } finally {
      setAiLoading(false);
    }
  }

  async function handleExportPdf(targetView: PdfView) {
    if (!data || loading) return;
    const previousView = view;
    setPdfExporting(targetView);
    try {
      if (targetView !== view) {
        setView(targetView);
        await sleep(450);
      } else {
        await sleep(250);
      }

      const element = targetView === 'overview' ? overviewSectionRef.current : analyticsSectionRef.current;
      if (!element) throw new Error('Не удалось подготовить секцию для экспорта.');

      await exportElementToPdf({
        element,
        filename: `jira-${targetView}-${new Date().toISOString().slice(0, 10)}.pdf`,
        title:
          targetView === 'overview'
            ? 'JIRA Metrics Hub: обзор разработчика'
            : 'JIRA Metrics Hub: аналитика и динамика',
        generatedAt: formatDateTime(new Date().toISOString())
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось экспортировать PDF.');
    } finally {
      if (previousView !== targetView) setView(previousView);
      setPdfExporting(null);
    }
  }

  return (
    <div className="page">
      <header className="hero">
        <div className="hero-content">
          <div className="hero-copy">
            <p className="eyebrow">JIRA Metrics Hub</p>
            <h1>Операционный дашборд загрузки, качества и прогнозов</h1>
            <p className="subtitle">
              Агрегаты строятся по вашим JQL через `total`, плюс тренды по месяцам, ETA хвоста,
              качество оценки и финансовые ориентиры.
            </p>
          </div>
          <div className="hero-panel">
            <span className="panel-label">Текущий assignee</span>
            <strong>{selectedAssignee}</strong>
            <span>Период: {periodOptions.find((option) => option.value === periodMonths)?.label}</span>
          </div>
        </div>
        <div className="hero-metrics" aria-label="Короткая сводка">
          <div>
            <span>Core score</span>
            <strong>{formatDecimal(finalRating)}</strong>
          </div>
          <div>
            <span>Resolved 90д</span>
            <strong>{formatNumber(throughput90)}</strong>
          </div>
          <div>
            <span>Текущий WIP</span>
            <strong>{data ? formatNumber(metricByKey(data.metrics, 'wipNow')) : 'нет данных'}</strong>
          </div>
          <div>
            <span>Worklog месяц</span>
            <strong>{formatDecimal(loggedHoursCurrentMonth)} ч</strong>
          </div>
        </div>
      </header>

      <section className="toolbar card">
        <div className="toolbar-left">
          <label className="field">
            Jira user
            <select value={selectedAssignee} onChange={(event) => setSelectedAssignee(event.target.value)}>
              {jiraUserOptions.map((user) => (
                <option key={user} value={user}>
                  {user}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Период графиков
            <select value={periodMonths} onChange={(event) => setPeriodMonths(Number(event.target.value))}>
              {periodOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Тема
            <select value={themePreference} onChange={(event) => setThemePreference(event.target.value as ThemePreference)}>
              {themeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => setReloadNonce((prev) => prev + 1)} className="ghost-btn">
            Обновить
          </button>
        </div>

        <div className="toolbar-right">
          <button type="button" className="ghost-btn" onClick={handleAiAssessment} disabled={!data || aiLoading}>
            {aiLoading ? 'AI анализирует...' : 'Получить AI-разбор'}
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() =>
              data && triggerDownload('jira-monthly.json', JSON.stringify(data.monthly, null, 2), 'application/json')
            }
          >
            Экспорт JSON
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() =>
              data && triggerDownload('jira-dashboard-full.json', JSON.stringify(data, null, 2), 'application/json')
            }
          >
            Экспорт всех данных
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => data && triggerDownload('jira-monthly.csv', toCsv(data), 'text/csv;charset=utf-8')}
          >
            Экспорт CSV
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => void handleExportPdf('overview')}
            disabled={!data || loading || pdfExporting !== null}
          >
            {pdfExporting === 'overview' ? 'PDF обзора...' : 'Экспорт PDF обзора'}
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => void handleExportPdf('analytics')}
            disabled={!data || loading || pdfExporting !== null}
          >
            {pdfExporting === 'analytics' ? 'PDF аналитики...' : 'Экспорт PDF аналитики'}
          </button>
        </div>
      </section>

      <nav className="tabs" aria-label="Навигация по дашборду">
        <button className={view === 'overview' ? 'tab active' : 'tab'} onClick={() => setView('overview')}>
          Обзор
        </button>
        <button className={view === 'analytics' ? 'tab active' : 'tab'} onClick={() => setView('analytics')}>
          Аналитика
        </button>
        <button className={view === 'forecast' ? 'tab active' : 'tab'} onClick={() => setView('forecast')}>
          Прогноз
        </button>
        <button className={view === 'compare' ? 'tab active' : 'tab'} onClick={() => setView('compare')}>
          Сравнение
        </button>
      </nav>

      {loading && <LoadingBlock label="Тяну данные из Jira, это может занять время" />}
      {error && <div className="state-card error">{error}</div>}
      {compareError && view === 'compare' && <div className="state-card error">{compareError}</div>}
      {aiError && <div className="state-card error">{aiError}</div>}

      {view === 'compare' && (
        <main className="content">
          <section className="grid compare-toolbar-grid">
            <article className="card compare-config-card">
              <p className="card-title">Сравнение сотрудников</p>
              <div className="compare-selects">
                <label className="field">
                  Пользователь слева
                  <select value={compareAssigneeLeft} onChange={(event) => setCompareAssigneeLeft(event.target.value)}>
                    {jiraUserOptions.map((user) => (
                      <option key={`left-${user}`} value={user}>
                        {user}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Пользователь справа
                  <select value={compareAssigneeRight} onChange={(event) => setCompareAssigneeRight(event.target.value)}>
                    {jiraUserOptions.map((user) => (
                      <option key={`right-${user}`} value={user}>
                        {user}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </article>
          </section>

          {compareLoading && <LoadingBlock label="Собираю данные для сравнения" />}

          {!compareLoading && compareDataLeft && compareDataRight && (
            <>
              <section className="grid compare-summary-grid">
                {compareSummaryCards.map((item) => (
                  <article key={item.label} className="card kpi-card">
                    <TitleWithHint title={item.label} hint={item.hint} />
                    <p className="compare-kpi-line">
                      <strong>{compareDataLeft.assignee}:</strong> {item.formatter(item.left)}
                    </p>
                    <p className="compare-kpi-line">
                      <strong>{compareDataRight.assignee}:</strong> {item.formatter(item.right)}
                    </p>
                    <p className="compare-delta">Разница: {item.formatter(item.left - item.right)}</p>
                  </article>
                ))}
              </section>

              <section className="grid analytics-grid">
                <article className="card large-card">
                  <TitleWithHint
                    title="Ключевые метрики"
                    hint="Сводное сравнение основных Jira-метрик двух сотрудников за одинаковый период."
                  />
                  <div className="compare-table">
                    <div className="compare-table-head">Метрика</div>
                    <div className="compare-table-head">{compareDataLeft.assignee}</div>
                    <div className="compare-table-head">{compareDataRight.assignee}</div>
                    <div className="compare-table-head">Дельта</div>
                    {compareMetricRows.map((row) => (
                      <Fragment key={row.label}>
                        <div className="compare-cell compare-label">
                          <TitleWithHint title={row.label} hint={row.hint} />
                        </div>
                        <div className="compare-cell">
                          {formatNumber(row.left)}
                        </div>
                        <div className="compare-cell">
                          {formatNumber(row.right)}
                        </div>
                        <div className="compare-cell">
                          {formatDelta(row.delta)}
                        </div>
                      </Fragment>
                    ))}
                  </div>
                </article>

                <article className="card chart-card">
                  <p className="card-title">Resolved по месяцам</p>
                  <div className="chart-wrap">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={compareTrendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                        <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="leftResolved" name={`${compareDataLeft.assignee} resolved`} fill="var(--chart-1)" />
                        <Bar dataKey="rightResolved" name={`${compareDataRight.assignee} resolved`} fill="var(--chart-2)" />
                        <Line type="monotone" dataKey="leftCreated" name={`${compareDataLeft.assignee} created`} stroke="var(--chart-1)" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="rightCreated" name={`${compareDataRight.assignee} created`} stroke="var(--chart-2)" strokeWidth={2} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </article>
              </section>

              <section className="grid analytics-grid">
                <article className="card large-card">
                  <TitleWithHint
                    title="1. Задачи по месяцам"
                    hint="Помесячное сравнение created и resolved за выбранный период. Показываются только данные из текущей Jira-выборки."
                  />
                  <div className="compare-table compare-table-monthly">
                    <div className="compare-table-head">Месяц</div>
                    <div className="compare-table-head">{compareDataLeft.assignee} created</div>
                    <div className="compare-table-head">{compareDataLeft.assignee} closed</div>
                    <div className="compare-table-head">{compareDataRight.assignee} created</div>
                    <div className="compare-table-head">{compareDataRight.assignee} closed</div>
                    {compareMonthlyRows.map((row) => (
                      <Fragment key={`month-${row.monthLabel}`}>
                        <div className="compare-cell compare-label">{row.monthLabel}</div>
                        <div className="compare-cell">{formatNumber(row.leftCreated)}</div>
                        <div className="compare-cell">{formatNumber(row.leftResolved)}</div>
                        <div className="compare-cell">{formatNumber(row.rightCreated)}</div>
                        <div className="compare-cell">{formatNumber(row.rightResolved)}</div>
                      </Fragment>
                    ))}
                  </div>
                </article>
              </section>

              <section className="grid analytics-grid">
                <article className="card">
                  <TitleWithHint
                    title="2. Скорость и ритм"
                    hint="Сводные показатели темпа за выбранный период и сигналы качества по последним 90 дням."
                  />
                  <div className="compare-table">
                    <div className="compare-table-head">Показатель</div>
                    <div className="compare-table-head">{compareDataLeft.assignee}</div>
                    <div className="compare-table-head">{compareDataRight.assignee}</div>
                    <div className="compare-table-head">Дельта</div>
                    {compareSpeedRows.map((row) => (
                      <Fragment key={`speed-${row.label}`}>
                        <div className="compare-cell compare-label">
                          <TitleWithHint title={row.label} hint={row.hint} />
                        </div>
                        <div className="compare-cell">{row.formatter(row.left)}</div>
                        <div className="compare-cell">{row.formatter(row.right)}</div>
                        <div className="compare-cell">{formatDelta((row.left ?? 0) - (row.right ?? 0))}</div>
                      </Fragment>
                    ))}
                  </div>
                </article>

                <article className="card">
                  <TitleWithHint
                    title="3. Текущий хвост"
                    hint="Сравнение незавершённой нагрузки, доли активной работы и признаков залипания."
                  />
                  <div className="compare-table">
                    <div className="compare-table-head">Показатель</div>
                    <div className="compare-table-head">{compareDataLeft.assignee}</div>
                    <div className="compare-table-head">{compareDataRight.assignee}</div>
                    <div className="compare-table-head">Дельта</div>
                    {compareBacklogRows.map((row) => (
                      <Fragment key={`backlog-${row.label}`}>
                        <div className="compare-cell compare-label">
                          <TitleWithHint title={row.label} hint={row.hint} />
                        </div>
                        <div className="compare-cell">{row.formatter(row.left)}</div>
                        <div className="compare-cell">{row.formatter(row.right)}</div>
                        <div className="compare-cell">{formatDelta((row.left ?? 0) - (row.right ?? 0))}</div>
                      </Fragment>
                    ))}
                  </div>
                </article>
              </section>

              <section className="grid analytics-grid">
                <article className="card">
                  <TitleWithHint
                    title="4. Распределение работы и ответственности"
                    hint="RACI-подобные прокси-метрики по Jira: ясность ответственности, фокус, контекстные переключения, ширина роли и нагрузка относительно темпа."
                  />
                  <div className="compare-table">
                    <div className="compare-table-head">Показатель</div>
                    <div className="compare-table-head">{compareDataLeft.assignee}</div>
                    <div className="compare-table-head">{compareDataRight.assignee}</div>
                    <div className="compare-table-head">Дельта</div>
                    {compareResponsibilityRows.map((row) => (
                      <Fragment key={`responsibility-${row.label}`}>
                        <div className="compare-cell compare-label">
                          <TitleWithHint title={row.label} hint={row.hint} />
                        </div>
                        <div className="compare-cell">{row.formatter(row.left)}</div>
                        <div className="compare-cell">{row.formatter(row.right)}</div>
                        <div className="compare-cell">{row.formatter((row.left ?? 0) - (row.right ?? 0))}</div>
                      </Fragment>
                    ))}
                  </div>
                </article>
              </section>

              <section className="grid analytics-grid">
                <article className="card">
                  <TitleWithHint
                    title="5. Итоговый скоринг"
                    hint="Используются уже рассчитанные баллы дашборда: предсказуемость, качество, поток, доставка и итоговый core score."
                  />
                  <div className="compare-table">
                    <div className="compare-table-head">Критерий</div>
                    <div className="compare-table-head">{compareDataLeft.assignee}</div>
                    <div className="compare-table-head">{compareDataRight.assignee}</div>
                    <div className="compare-table-head">Дельта</div>
                    {compareScoreRows.map((row) => (
                      <Fragment key={`score-${row.label}`}>
                        <div className="compare-cell compare-label">{row.label}</div>
                        <div className="compare-cell">{row.formatter(row.left)}</div>
                        <div className="compare-cell">{row.formatter(row.right)}</div>
                        <div className="compare-cell">{row.formatter(row.left - row.right)}</div>
                      </Fragment>
                    ))}
                  </div>
                </article>

                <article className="card">
                  <TitleWithHint
                    title="6. Короткие выводы и риски"
                    hint="Автоматическая выжимка только по доступным Jira-полям. Если сигнала в данных нет, блок остаётся коротким."
                  />
                  <div className="compare-notes">
                    <div className="compare-notes-column">
                      <p className="compare-notes-title">{compareDataLeft.assignee}</p>
                      {compareNarratives?.left.length ? (
                        compareNarratives.left.map((note) => (
                          <p key={`left-note-${note}`} className="compare-note">
                            {note}
                          </p>
                        ))
                      ) : (
                        <p className="compare-note">Нет выраженных сигналов по текущей выборке.</p>
                      )}
                    </div>
                    <div className="compare-notes-column">
                      <p className="compare-notes-title">{compareDataRight.assignee}</p>
                      {compareNarratives?.right.length ? (
                        compareNarratives.right.map((note) => (
                          <p key={`right-note-${note}`} className="compare-note">
                            {note}
                          </p>
                        ))
                      ) : (
                        <p className="compare-note">Нет выраженных сигналов по текущей выборке.</p>
                      )}
                    </div>
                  </div>
                </article>
              </section>
            </>
          )}
        </main>
      )}

      {view !== 'compare' && !loading && !error && data && (
        <main className="content">
          {aiAssessment && (
            <section className="grid">
              <article className="card ai-card">
                <TitleWithHint
                  title={`AI-разбор дашборда: ${aiAssessment.overallStatus}`}
                  hint="Это честная интерпретация модели по всем метрикам текущего дашборда: качество, скорость, поток, прогнозы, worklog и финансовые оценки."
                />
                <p>{aiAssessment.summary}</p>
                <p>
                  <strong>Сильные стороны:</strong> {aiAssessment.strengths.join('; ') || 'нет данных'}
                </p>
                <p>
                  <strong>Риски:</strong> {aiAssessment.risks.join('; ') || 'нет данных'}
                </p>
                <p>
                  <strong>Приоритетные действия:</strong> {aiAssessment.actions.join('; ') || 'нет данных'}
                </p>
              </article>
            </section>
          )}

          <section className="insight-strip" aria-label="Основные сигналы">
            <article className="insight-card">
              <span className="insight-label">Предсказуемость</span>
              <strong>{formatDecimal(data.characteristics.predictabilityScore)}</strong>
              <span>{getHigherIsBetterAssessment(data.characteristics.predictabilityScore, 80, 60)}</span>
            </article>
            <article className="insight-card">
              <span className="insight-label">Качество</span>
              <strong>{formatDecimal(data.characteristics.qualityScore)}</strong>
              <span>{getHigherIsBetterAssessment(data.characteristics.qualityScore, 80, 60)}</span>
            </article>
            <article className="insight-card">
              <span className="insight-label">Фокус исполнения</span>
              <strong>{formatPercent(data.personal.executionFocusPercent)}</strong>
              <span>{getHigherIsBetterAssessment(data.personal.executionFocusPercent, 55, 35)}</span>
            </article>
            <article className="insight-card">
              <span className="insight-label">Риск увольнения</span>
              <strong>{formatPercent(data.characteristics.dismissalRiskPercent)}</strong>
              <span>{getDismissalRiskLabel(data.characteristics.dismissalRiskPercent)}</span>
            </article>
          </section>

          {view === 'overview' && (
            <section className="grid overview-grid" ref={overviewSectionRef}>
              {summaryCards.map((item) => (
                <article key={item.label} className="card kpi-card">
                  <TitleWithHint
                    title={item.label}
                    hint={
                      item.label === 'Все задачи, которые были на мне'
                        ? 'Исторический объем: все задачи, где вы когда-либо были назначены исполнителем.'
                        : item.label === 'Все выполненные задачи'
                          ? 'Все задачи из вашей истории назначения, у которых заполнено поле resolved.'
                          : item.label === 'Текущие задачи'
                        ? 'Все задачи, где вы сейчас назначены исполнителем. Сюда входят и завершенные, и незавершенные статусы.'
                        : item.label === 'Задачи в работе сейчас'
                          ? 'Только незавершенные задачи на вас (статусная категория не Done). Это реальная текущая нагрузка.'
                          : undefined
                    }
                  />
                  <p className="kpi-value">{formatNumber(item.value)}</p>
                </article>
              ))}

              <article className="card large-card">
                <TitleWithHint
                  title="Качество оценки (90 дней)"
                  hint="Показывает, насколько качественно оценивались задачи и как часто фактические трудозатраты расходятся с планом."
                />
                <div className="quality-lines">
                  <p>
                    Без оценки, но со списанным временем: <strong>{formatDecimal(data.quality.noEstimateShare)}%</strong>
                    <Hint text="Чем ниже, тем лучше. Ориентир: до 15% хорошо, 15-30% зона внимания, выше 30% плохо по предсказуемости." />
                  </p>
                  <p>
                    Перерасход среди задач с оценкой: <strong>{formatDecimal(data.quality.overrunShare)}%</strong>
                    <Hint text="Доля задач, где фактическое время больше оценки. До 20% обычно нормально, 20-35% спорно, выше 35% часто плохой сигнал." />
                  </p>
                  <p>
                    Среднее фактически списанное время на задачу:{' '}
                    <strong>{formatDecimal(data.quality.avgTimespentHours)} ч</strong>
                    <Hint text="Средний фактический объем работы в часах на одну задачу за период." />
                  </p>
                  <p>
                    Средняя исходная оценка задачи:{' '}
                    <strong>{formatDecimal(data.quality.avgEstimatedHours)} ч</strong>
                    <Hint text="Средняя плановая оценка по задачам. Важно смотреть вместе с фактическим временем и долей перерасхода." />
                  </p>
                  <p>
                    Скорость по формуле оценка / факт × 100:{' '}
                    <strong>{formatDecimal(data.quality.estimateToFactSpeedPercent)}%</strong>
                    <Hint text="100% = оценка совпадает с фактом. Ниже 100% — по факту тратите больше времени, чем оценивали. Выше 100% — закрываете быстрее оценки или закладываете запас." />
                  </p>
                  <p>
                    Оценка скорости:{' '}
                    <strong>
                      {getEstimateToFactSpeedAssessment(data.quality.estimateToFactSpeedPercent)}
                    </strong>
                  </p>
                  <p>
                    Проанализировано задач: <strong>{formatNumber(data.quality.sampledIssues)}</strong>
                  </p>
                </div>
              </article>

              <article className="card large-card">
                <p className="card-title">Рабочие часы по Jira worklog</p>
                <p>
                  План на месяц: <strong>{formatNumber(hours.totalMonthHours)} ч</strong>
                </p>
                <p>
                  Фактически списано в Jira за месяц: <strong>{formatNumber(loggedHoursCurrentMonth)} ч</strong>
                </p>
                <p>
                  План на текущую дату (по 5/2, 7ч): <strong>{formatNumber(hours.elapsedHours)} ч</strong>
                </p>
                <p>
                  Отклонение от план-графика: <strong>{formatNumber(loggedHoursCurrentMonth - hours.elapsedHours)} ч</strong>
                </p>
                <div className="progress-wrap" role="img" aria-label="Прогресс рабочего месяца">
                  <div className="progress-bar" style={{ width: `${worklogProgressBarPercent}%` }} />
                </div>
                <p className="progress-label">
                  {formatDecimal(worklogProgressRaw)}% месячного плана по фактическим worklog-часам
                </p>
              </article>

              <article className="card large-card">
                <TitleWithHint
                  title="Характеристики и общий рейтинг"
                  hint="Рейтинг строится на Jira-метриках: предсказуемость, качество, поток и доставка."
                />
                <p>
                  Предсказуемость: <strong>{formatDecimal(data.characteristics.predictabilityScore)}</strong>
                  <Hint text="Как читать: 80-100 хорошо, 60-79 приемлемо, ниже 60 плохо. Снижается, если много задач без оценки, частый перерасход и сильный разрыв между оценкой и фактом." />
                </p>
                <p>
                  Качество: <strong>{formatDecimal(data.characteristics.qualityScore)}</strong>
                  <Hint text="Как читать: 80-100 хорошо, 60-79 приемлемо, ниже 60 плохо. Снижается при большом количестве багов/переоткрытий и низком покрытии задач оценкой." />
                </p>
                <p>
                  Поток: <strong>{formatDecimal(data.characteristics.flowScore)}</strong>
                  <Hint text="Как читать: 80-100 хорошо, 60-79 приемлемо, ниже 60 плохо. Снижается, если растет доля залипших задач и индекс загрузки выходит из баланса." />
                </p>
                <p>
                  Доставка: <strong>{formatDecimal(data.characteristics.deliveryScore)}</strong>
                  <Hint text="Как читать: 80-100 хорошо, 60-79 приемлемо, ниже 60 плохо. Снижается, если темп последних 30 дней сильно хуже/лучше 90 дней (нестабильность) и если большой срок разгребания хвоста." />
                </p>
                <p>
                  Базовый общий рейтинг (только Jira):{' '}
                  <strong>{formatDecimal(data.characteristics.overallCoreScore)}</strong>
                  <Hint text="Среднее по четырем характеристикам. 80+ хорошо, 65-79 рабочий уровень, ниже 65 нужна стабилизация процесса." />
                </p>
                <p>
                  Риск увольнения по метрикам:{' '}
                  <strong>{formatPercent(data.characteristics.dismissalRiskPercent)}</strong> (
                  {getDismissalRiskLabel(data.characteristics.dismissalRiskPercent)})
                  <Hint text="Эвристический индекс 0-100% по Jira-метрикам: общий score, качество, предсказуемость, доля залипших задач, переоткрытия и давление WIP. Это не HR-вердикт, а управленческий сигнал." />
                </p>
                <p>
                  Подробная интерпретация рейтинга:
                  <strong>
                    {' '}
                    {finalRating != null && finalRating >= 80
                      ? 'сильная устойчивая производительность'
                      : finalRating != null && finalRating >= 65
                        ? 'рабочая стабильность, есть зоны для улучшения'
                        : 'риск по срокам/качеству, нужны корректировки процесса'}
                  </strong>
                </p>
                <p>
                  Общий рейтинг: <strong>{formatDecimal(finalRating)}</strong>
                </p>
              </article>

              <article className="card large-card">
                <TitleWithHint
                  title="Персональные метрики (bigtech-style)"
                  hint="Индивидуальные процессные сигналы: качество планирования, доля срочности, стабильность поставки и фокус в текущем WIP."
                />
                <p>
                  Покрытие задач оценкой (90д):{' '}
                  <strong>{formatDecimal(data.personal.estimateCoverage90Percent)}%</strong> (
                  {getHigherIsBetterAssessment(data.personal.estimateCoverage90Percent, 75, 55)})
                </p>
                <p>
                  Доля срочных задач High/Highest (90д):{' '}
                  <strong>{formatDecimal(data.personal.urgentLoadShare90Percent)}%</strong> (
                  {getLowerIsBetterAssessment(data.personal.urgentLoadShare90Percent, 25, 40)})
                </p>
                <p>
                  Доля багов в закрытии (90д): <strong>{formatDecimal(data.personal.bugShare90Percent)}%</strong> (
                  {getLowerIsBetterAssessment(data.personal.bugShare90Percent, 20, 35)})
                </p>
                <p>
                  Rate переоткрытий (90д): <strong>{formatDecimal(data.personal.reopenRate90Percent)}%</strong> (
                  {getLowerIsBetterAssessment(data.personal.reopenRate90Percent, 10, 20)})
                </p>
                <p>
                  Доля залипших в текущем хвосте: <strong>{formatDecimal(data.personal.staleShareCurrentPercent)}%</strong> (
                  {getLowerIsBetterAssessment(data.personal.staleShareCurrentPercent, 20, 35)})
                </p>
                <p>
                  Фокус исполнения (In Progress / весь хвост):{' '}
                  <strong>{formatDecimal(data.personal.executionFocusPercent)}%</strong> (
                  {getHigherIsBetterAssessment(data.personal.executionFocusPercent, 55, 35)})
                </p>
                <p>
                  Доля крупных задач (≥8ч) в закрытии за год:{' '}
                  <strong>{formatDecimal(data.personal.complexityShareYearPercent)}%</strong>
                </p>
                <p>
                  Доля эпиков в закрытии за год:{' '}
                  <strong>{formatDecimal(data.personal.initiativeShareYearPercent)}%</strong>
                </p>
                <p>
                  Индекс стабильности доставки (30д к 90д):{' '}
                  <strong>{formatDecimal(data.personal.deliveryStabilityIndex)}</strong> (
                  {getHigherIsBetterAssessment(data.personal.deliveryStabilityIndex, 85, 70)})
                </p>
                <p>
                  Моментум темпа (30д к 90д):{' '}
                  <strong>{formatDecimal(data.personal.throughputMomentum30to90Percent)}%</strong> (
                  {getHigherIsBetterAssessment(data.personal.throughputMomentum30to90Percent, 95, 80)})
                </p>
                <p>
                  Давление хвоста (недель до разгребания при темпе 90д):{' '}
                  <strong>{formatDecimal(data.personal.wipPressureWeeks)}</strong> (
                  {getWipPressureAssessment(data.personal.wipPressureWeeks)})
                </p>
                <p>
                  Ширина компетенций: <strong>{formatNumber(data.personal.competencyBreadth)}</strong> из 10
                </p>
                <p>
                  Покрытие competency-модели:{' '}
                  <strong>{formatDecimal(data.personal.competencyCoveragePercent)}%</strong> (
                  {getHigherIsBetterAssessment(data.personal.competencyCoveragePercent, 70, 45)})
                </p>
              </article>

              <article className="card large-card">
                <TitleWithHint
                  title="Матрица компетенций по Jira-задачам"
                  hint="Построена эвристически по текстам summary/description/labels/components задач за 365 дней."
                />
                <p>
                  Проанализировано задач за год: <strong>{formatNumber(data.competency.analyzedIssuesYear)}</strong>
                </p>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={competencyRadarData} outerRadius="72%">
                      <PolarGrid stroke="var(--chart-grid)" />
                      <PolarAngleAxis dataKey="skill" tick={{ fontSize: 11 }} />
                      <PolarRadiusAxis domain={[0, 60]} tick={{ fontSize: 10 }} />
                      <Radar
                        name="Компетенции"
                        dataKey="score"
                        stroke="var(--chart-2)"
                        fill="var(--chart-2)"
                        fillOpacity={0.28}
                      />
                      <Tooltip formatter={(value) => [formatDecimal(Number(value)), 'Score']} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
                {data.competency.matrix.slice(0, 6).map((item) => (
                  <div key={item.key} className="volume-row">
                    <p>
                      <strong>{item.label}</strong>: уровень <strong>{item.level}</strong>, score{' '}
                      <strong>{formatDecimal(item.score)}</strong>, задач за год{' '}
                      <strong>{formatNumber(item.issueCountYear)}</strong>, за 90 дней{' '}
                      <strong>{formatNumber(item.issueCount90)}</strong>.
                    </p>
                    <p>
                      Примеры: <strong>{item.sampleIssues.join(' | ') || 'нет данных'}</strong>
                    </p>
                  </div>
                ))}
              </article>
            </section>
          )}

          {view === 'analytics' && (
            <section className="grid analytics-grid" ref={analyticsSectionRef}>
              <article className="card large-card">
                <TitleWithHint
                  title="Расширенный flow-анализ за период"
                  hint="Детальная выборка строится по задачам, которые обновлялись, создавались или закрывались в выбранном периоде. Для очень больших периодов действует лимит VITE_JIRA_DETAILED_MAX_PAGES."
                />
                <p>
                  Период: <strong>{data.flow.periodStart}</strong> - <strong>{data.flow.periodEnd}</strong>,
                  детально проанализировано задач: <strong>{formatNumber(data.flow.sampledIssues)}</strong>.
                </p>
                <div className="flow-kpi-grid">
                  {flowCards.map((item) => (
                    <div key={item.label} className="flow-kpi">
                      <TitleWithHint title={item.label} hint={item.hint} />
                      <strong>
                        {formatDecimal(item.value)} {item.value == null ? '' : item.suffix}
                      </strong>
                    </div>
                  ))}
                </div>
              </article>

              <article className="card large-card">
                <TitleWithHint
                  title="Изменения и охват периода"
                  hint="Created/updated/reopened берутся из Jira; planned close считается по due date или полю VITE_JIRA_PLANNED_CLOSE_FIELD, так как спринтов нет."
                />
                <div className="flow-facts-grid">
                  <p>
                    Добавилось задач: <strong>{formatNumber(data.flow.periodAdded)}</strong>
                  </p>
                  <p>
                    Переоткрылось: <strong>{formatNumber(data.flow.periodReopened)}</strong>
                  </p>
                  <p>
                    Изменилось: <strong>{formatNumber(data.flow.periodChanged)}</strong>
                  </p>
                  <p>
                    Планировалось закрыть: <strong>{formatNumber(data.flow.plannedToClose)}</strong>
                  </p>
                  <p>
                    Реально закрыто: <strong>{formatNumber(data.flow.actuallyClosed)}</strong>
                  </p>
                  <p>
                    Проектов: <strong>{formatNumber(data.flow.distinctProjects)}</strong>
                  </p>
                  <p>
                    Компонентов: <strong>{formatNumber(data.flow.distinctComponents)}</strong>
                  </p>
                  <p>
                    Эпиков: <strong>{formatNumber(data.flow.distinctEpics)}</strong>
                  </p>
                  <p>
                    Срочные среди закрытых:{' '}
                    <strong>{formatPercent(data.flow.urgentClosedSharePercent)}</strong>
                  </p>
                  <p>
                    Мелкие переключения по worklog:{' '}
                    <strong>{formatPercent(data.flow.contextSwitchingSharePercent)}</strong>
                  </p>
                </div>
              </article>

              <article className="card large-card">
                <TitleWithHint
                  title="Время в статусах"
                  hint="Сумма и среднее время по статусам Review, Blocked, Уточнение деталей, QA/Acceptance. Названия настраиваются через env."
                />
                <StatusDurationList items={data.flow.statusDurations} />
              </article>

              <article className="card large-card">
                <TitleWithHint
                  title="Связь Jira с GitLab"
                  hint="Опционально: GitLab MR связываются с Jira по ключам задач в title/description/source branch. Работает при VITE_GITLAB_TOKEN."
                />
                {!data.flow.gitlab.enabled && (
                  <p className="progress-label">GitLab не подключен: не задан VITE_GITLAB_TOKEN.</p>
                )}
                {data.flow.gitlab.enabled && data.flow.gitlab.error && (
                  <p className="progress-label">Ошибка GitLab: {data.flow.gitlab.error}</p>
                )}
                {data.flow.gitlab.enabled && !data.flow.gitlab.error && (
                  <>
                    <p>
                      Просканировано MR: <strong>{formatNumber(data.flow.gitlab.scannedMergeRequests)}</strong>,
                      задач с MR: <strong>{formatNumber(data.flow.gitlab.linkedIssueCount)}</strong>.
                    </p>
                    <div className="mini-table">
                      {data.flow.gitlab.linkedIssues.slice(0, 8).map((item) => (
                        <Fragment key={`gitlab-${item.issueKey}`}>
                          <div className="mini-cell mini-key">{item.issueKey}</div>
                          <div className="mini-cell">MR: {formatNumber(item.mergeRequests)}</div>
                          <div className="mini-cell mini-value">Merged: {formatNumber(item.merged)}</div>
                        </Fragment>
                      ))}
                    </div>
                  </>
                )}
              </article>

              <article className="card large-card">
                <TitleWithHint
                  title="Задачи, которые портят метрики"
                  hint="Топы строятся по длительности, расхождению оценки с фактом и текущему залипанию."
                />
                <IssueMetricList title="Самые долгие creation → close" items={data.flow.topLongest} />
                <IssueMetricList title="Самые переоцененные" items={data.flow.topOverestimated} />
                <IssueMetricList title="Самые недооцененные" items={data.flow.topUnderestimated} />
                <IssueMetricList title="Самые залипшие открытые" items={data.flow.topStuck} />
              </article>

              <article className="card large-card">
                <TitleWithHint
                  title="Без оценки, но с фактическим временем"
                  hint="Список задач, где original estimate пустой, но timespent больше нуля."
                />
                <IssueMetricList title="Нет оценки, есть worklog/time spent" items={data.flow.noEstimateWithSpentIssues} />
              </article>

              <article className="card chart-card">
                <p className="card-title">Созданные и выполненные задачи по месяцам</p>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.monthly}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                      <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="created"
                        name="Создано"
                        stroke="var(--chart-4)"
                        strokeWidth={2.5}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="resolved"
                        name="Выполнено"
                        stroke="var(--chart-2)"
                        strokeWidth={2.5}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </article>

              <article className="card chart-card">
                <p className="card-title">
                  Выполненные задачи и скользящее среднее за 3 и 6 месяцев
                </p>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data.monthly}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                      <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="resolved" name="Выполнено" fill="var(--chart-2)" radius={[8, 8, 0, 0]} />
                      <Line
                        type="monotone"
                        dataKey="ma3"
                        name="Скользящее среднее за 3 месяца"
                        stroke="var(--chart-1)"
                        dot={false}
                        strokeWidth={2}
                      />
                      <Line
                        type="monotone"
                        dataKey="ma6"
                        name="Скользящее среднее за 6 месяцев"
                        stroke="var(--chart-5)"
                        dot={false}
                        strokeWidth={2}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </article>

              <article className="card chart-card">
                <p className="card-title">Закрытые баги по месяцам</p>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.monthly}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                      <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="bugs" fill="var(--chart-5)" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </article>

              <article className="card chart-card">
                <p className="card-title">Тренд задач в работе (дневные снимки в браузере)</p>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.wipTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="wip"
                        name="Задачи в работе"
                        stroke="var(--chart-3)"
                        strokeWidth={2.5}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </article>

              <article className="card chart-card">
                <p className="card-title">Динамика персональных метрик по месяцам</p>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.monthly}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                      <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} />
                      <Tooltip />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="estimateCoveragePercent"
                        name="Покрытие оценкой %"
                        stroke="var(--chart-2)"
                        strokeWidth={2.2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="urgentSharePercent"
                        name="Срочные задачи %"
                        stroke="var(--chart-4)"
                        strokeWidth={2.2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="bugSharePercent"
                        name="Доля багов %"
                        stroke="var(--chart-5)"
                        strokeWidth={2.2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </article>

              <article className="card chart-card">
                <p className="card-title">Денежная динамика (при введенной зарплате)</p>
                {!hasSalary && (
                  <p className="progress-label">
                    Введите месячную зарплату во вкладке «Прогноз», чтобы увидеть стоимость задачи и багов по месяцам.
                  </p>
                )}
                {hasSalary && (
                  <div className="chart-wrap">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={monthlyMoneyTrend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                        <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="costPerTask"
                          name="Стоимость 1 задачи"
                          stroke="var(--chart-3)"
                          strokeWidth={2.2}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="bugCost"
                          name="Стоимость багов в месяце"
                          stroke="var(--chart-2)"
                          strokeWidth={2.2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </article>
            </section>
          )}

          {view === 'forecast' && (
            <section className="grid forecast-grid">
              <article className="card kpi-card">
                <p className="card-title">Текущий хвост задач</p>
                <p className="kpi-value">{formatNumber(data.forecast.backlog)}</p>
              </article>
              <article className="card kpi-card">
                <p className="card-title">Скорость в неделю (за 30 дней)</p>
                <p className="kpi-value">{formatDecimal(data.forecast.throughputPerWeek30)}</p>
              </article>
              <article className="card kpi-card">
                <p className="card-title">Скорость в неделю (за 90 дней)</p>
                <p className="kpi-value">{formatDecimal(data.forecast.throughputPerWeek90)}</p>
              </article>

              <article className="card large-card">
                <TitleWithHint
                  title="Оценка срока разгребания хвоста (в неделях)"
                  hint="Хвост считается как текущие незавершенные задачи. Расчет предполагает, что приток новых задач не растет резко."
                />
                <p>
                  Оптимистичный сценарий: <strong>{formatDecimal(data.forecast.optimisticEtaWeeks)}</strong>
                  <Hint text="Расчет от лучшей текущей скорости. Обычно достижим при стабильной фокусной работе и низком количестве срочных переключений." />
                </p>
                <p>
                  Медианный сценарий: <strong>{formatDecimal(data.forecast.medianEtaWeeks)}</strong>
                  <Hint text="Базовый реалистичный сценарий между быстрым и медленным темпом. Обычно его используют как основной ориентир." />
                </p>
                <p>
                  Пессимистичный сценарий: <strong>{formatDecimal(data.forecast.pessimisticEtaWeeks)}</strong>
                  <Hint text="Сценарий при более медленном темпе. Если он растет, это сигнал перегруза или высокой неопределенности." />
                </p>
              </article>

              <article className="card large-card">
                <TitleWithHint
                  title="Прогноз производительности на следующий месяц"
                  hint="Прогноз построен на недавней динамике: созданные и выполненные задачи, а также скользящее среднее."
                />
                <p>
                  Ожидаемое количество выполненных задач:{' '}
                  <strong>{formatDecimal(data.forecast.forecastCompletedNextMonth)}</strong>
                  <Hint text="Ожидаемая месячная выработка. Для одного фронтенд-разработчика рабочий диапазон часто около 10-22 задач/месяц (зависит от сложности)." />
                </p>
                <p>
                  Ожидаемое количество новых задач:{' '}
                  <strong>{formatDecimal(data.forecast.forecastIncomingNextMonth)}</strong>
                  <Hint text="Прогноз входящего потока. Если он стабильно выше выполненных, хвост будет расти." />
                </p>
                <p>
                  Ожидаемый хвост к концу следующего месяца:{' '}
                  <strong>{formatDecimal(data.forecast.forecastBacklogEndNextMonth)}</strong>
                  <Hint text="Если значение растет месяц к месяцу, это признак системной перегрузки или недооценки задач." />
                </p>
                <p>
                  Индекс загрузки (входящий поток / выполненные):{' '}
                  <strong>{formatDecimal(data.forecast.loadIndexPercent)}%</strong>
                  <Hint text="Ниже 90% — хвост обычно сокращается (хорошо). 90-110% — баланс. Выше 110% — перегруз, хвост почти наверняка растет." />
                </p>
                <p>
                  Оценка индекса загрузки: <strong>{getLoadIndexAssessment(data.forecast.loadIndexPercent)}</strong>
                </p>
                <p>
                  Потенциал закрытия задач в месяц по темпу последних 30 дней:{' '}
                  <strong>{formatDecimal(data.forecast.throughputPerMonth30)}</strong>
                  <Hint text="Короткий горизонт, быстро реагирует на изменения. Полезен для ближайшего планирования." />
                </p>
                <p>
                  Оценка темпа за 30 дней:{' '}
                  <strong>{getMonthCapacityAssessment(data.forecast.throughputPerMonth30)}</strong>
                </p>
                <p>
                  Потенциал закрытия задач в месяц по темпу последних 90 дней:{' '}
                  <strong>{formatDecimal(data.forecast.throughputPerMonth90)}</strong>
                  <Hint text="Более устойчивый темп без резких скачков. Полезен для квартального планирования." />
                </p>
                <p>
                  Оценка темпа за 90 дней:{' '}
                  <strong>{getMonthCapacityAssessment(data.forecast.throughputPerMonth90)}</strong>
                </p>
                <p>
                  Прогноз по скользящему среднему за 3 месяца:{' '}
                  <strong>{formatDecimal(data.forecast.forecastNextMonthMa3)}</strong>
                  <Hint text="Прогноз на основе последних 3 месяцев. Чувствителен к последним изменениям загрузки." />
                </p>
                <p>
                  Прогноз по скользящему среднему за 6 месяцев:{' '}
                  <strong>{formatDecimal(data.forecast.forecastNextMonthMa6)}</strong>
                  <Hint text="Прогноз на основе 6 месяцев. Более стабильный, но медленнее реагирует на свежие изменения." />
                </p>
                <p>
                  Оценка срока разгребания (медианный сценарий):{' '}
                  <strong>{getEtaAssessment(data.forecast.medianEtaWeeks)}</strong>
                </p>
              </article>

              <article className="card large-card">
                <p className="card-title">Оценка объема выполненных задач и реалистичности темпа</p>
                {data.forecast.volumeAssessment.map((item) => (
                  <div key={item.periodLabel} className="volume-row">
                    <p>
                      <strong>{item.periodLabel}:</strong> выполнено <strong>{formatNumber(item.completed)}</strong>,
                      с оценкой <strong>{formatNumber(item.withEstimate)}</strong> (
                      <strong>{formatDecimal(item.estimateCoveragePercent)}%</strong>), темп{' '}
                      <strong>{formatDecimal(item.completedPerMonth)}</strong> задач/месяц.
                    </p>
                    <p>
                      Статус: <strong>{item.benchmarkStatus}</strong>. {item.benchmarkComment}
                    </p>
                  </div>
                ))}
              </article>

              <article className="card large-card">
                <TitleWithHint
                  title="Зарплата, ставка и стоимость задачи"
                  hint="Расчет ориентировочный. Введите месячную зарплату, и система покажет оценку на текущий момент по рабочему календарю и по фактически списанным часам в Jira."
                />
                <label className="field">
                  Коэффициент переработок
                  <select
                    value={overtimeMultiplier}
                    onChange={(event) => setOvertimeMultiplier(Number(event.target.value))}
                  >
                    <option value={1}>x1</option>
                    <option value={1.5}>x1.5</option>
                    <option value={2}>x2</option>
                  </select>
                </label>
                <label className="field">
                  Месячная зарплата (сумма)
                  <input
                    className="salary-input"
                    value={salaryInput}
                    onChange={(event) => setSalaryInput(event.target.value)}
                    placeholder="Например, 250000"
                  />
                </label>
                <p>
                  Заработано на текущий момент по рабочему календарю:{' '}
                  <strong>{formatDecimal(earnedBySchedule)}</strong>
                </p>
                <p>
                  Фактически списано часов в Jira за текущий месяц (worklog):{' '}
                  <strong>{formatDecimal(data.worklog.loggedHoursCurrentMonth)}</strong>
                </p>
                <p>
                  Заработано по фактическим worklog-часам:{' '}
                  <strong>{formatDecimal(earnedByWorklog)}</strong>
                </p>
                <p>
                  Итоговая заработанная сумма с учетом переработок ({`x${overtimeMultiplier}`}):{' '}
                  <strong>{formatDecimal(earnedTotalWithOvertime)}</strong>
                </p>
                <p>
                  Плановая ставка в час: <strong>{formatDecimal(planHourlyRate)}</strong>
                </p>
                <p>
                  Примерная стоимость одной задачи (по прогнозу следующего месяца):{' '}
                  <strong>{formatMoney(taskCostByForecast)}</strong>
                </p>
                <p>
                  Фактическая стоимость 1 закрытой задачи (30д): <strong>{formatMoney(costPerTask30)}</strong>
                </p>
                <p>
                  Фактическая стоимость 1 закрытой задачи (90д): <strong>{formatMoney(costPerTask90)}</strong>
                </p>
                <p>
                  Стоимость потока багов за 90д: <strong>{formatMoney(bugCost90)}</strong>
                </p>
                <p>
                  Стоимость срочных задач High/Highest за 90д: <strong>{formatMoney(urgentCost90)}</strong>
                </p>
                <p>
                  Денежная оценка текущего хвоста: <strong>{formatMoney(backlogCostExposure)}</strong>
                </p>
                <p>
                  Отклонение от планового заработка на текущую дату:{' '}
                  <strong>{formatMoney(moneyGapVsSchedule)}</strong>
                </p>
                <p>
                  Премия за переработки (только коэффициент {`x${overtimeMultiplier}`}):{' '}
                  <strong>{formatMoney(overtimePremiumCost)}</strong>
                </p>
              </article>
            </section>
          )}

          <footer className="footer">Обновлено: {formatDateTime(data.fetchedAt)}</footer>
        </main>
      )}
    </div>
  );
}
