import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { generateAiAssessment } from './api/ai';
import { fetchDashboardData } from './api/jira';
import type { AiAssessment, DashboardData, MetricPoint } from './types';
import { calculateWorkHours } from './utils/hours';

type View = 'overview' | 'analytics' | 'forecast';

const periodOptions = [
  { value: 12, label: '1 год' },
  { value: 24, label: '2 года' },
  { value: 60, label: '5 лет' }
];

function formatNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU').format(value);
}

function formatDecimal(value: number | null): string {
  if (value == null) return 'нет данных';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
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

function metricByKey(metrics: MetricPoint[], key: string): number {
  return metrics.find((metric) => metric.key === key)?.total ?? 0;
}

function toCsv(data: DashboardData): string {
  const header = ['month', 'monthLabel', 'created', 'resolved', 'bugs', 'ma3', 'ma6'];
  const rows = data.monthly.map((row) =>
    [row.month, row.monthLabel, row.created, row.resolved, row.bugs, row.ma3 ?? '', row.ma6 ?? ''].join(',')
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

export default function App() {
  const [view, setView] = useState<View>('overview');
  const [periodMonths, setPeriodMonths] = useState(12);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiAssessment, setAiAssessment] = useState<AiAssessment | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [salaryInput, setSalaryInput] = useState('');
  const [overtimeMultiplier, setOvertimeMultiplier] = useState(1);

  const hours = useMemo(() => calculateWorkHours(new Date()), []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const next = await fetchDashboardData(periodMonths);
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
  }, [periodMonths, reloadNonce]);

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
  const finalRating = data?.characteristics.overallCoreScore ?? null;

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

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">JIRA Metrics Hub</p>
          <h1>Дашборд загрузки, качества и прогнозов</h1>
          <p className="subtitle">
            Агрегаты строятся по вашим JQL через `total`, плюс тренды по месяцам, ETA хвоста и
            качество оценки.
          </p>
        </div>
      </header>

      <section className="toolbar card">
        <div className="toolbar-left">
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
            onClick={() => data && triggerDownload('jira-monthly.csv', toCsv(data), 'text/csv;charset=utf-8')}
          >
            Экспорт CSV
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
      </nav>

      {loading && <div className="state-card">Тяну данные из Jira, это может занять время...</div>}
      {error && <div className="state-card error">{error}</div>}
      {aiError && <div className="state-card error">{aiError}</div>}

      {!loading && !error && data && (
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

          {view === 'overview' && (
            <section className="grid overview-grid">
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
            </section>
          )}

          {view === 'analytics' && (
            <section className="grid analytics-grid">
              <article className="card chart-card">
                <p className="card-title">Созданные и выполненные задачи по месяцам</p>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.monthly}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#d7e2ec" />
                      <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="created"
                        name="Создано"
                        stroke="#f59e0b"
                        strokeWidth={2.5}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="resolved"
                        name="Выполнено"
                        stroke="#2563eb"
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
                      <CartesianGrid strokeDasharray="3 3" stroke="#d7e2ec" />
                      <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="resolved" name="Выполнено" fill="#1f8a70" radius={[8, 8, 0, 0]} />
                      <Line
                        type="monotone"
                        dataKey="ma3"
                        name="Скользящее среднее за 3 месяца"
                        stroke="#7c3aed"
                        dot={false}
                        strokeWidth={2}
                      />
                      <Line
                        type="monotone"
                        dataKey="ma6"
                        name="Скользящее среднее за 6 месяцев"
                        stroke="#dc2626"
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
                      <CartesianGrid strokeDasharray="3 3" stroke="#d7e2ec" />
                      <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="bugs" fill="#ef4444" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </article>

              <article className="card chart-card">
                <p className="card-title">Тренд задач в работе (дневные снимки в браузере)</p>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.wipTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#d7e2ec" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="wip"
                        name="Задачи в работе"
                        stroke="#0f766e"
                        strokeWidth={2.5}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
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
                  <strong>{formatDecimal(taskCostByForecast)}</strong>
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
