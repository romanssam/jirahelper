import type { AiAssessment, DashboardData, WorkHoursStats } from '../types';

const deepSeekKey = import.meta.env.VITE_DEEPSEEK_API_KEY;
const deepSeekModel = import.meta.env.VITE_DEEPSEEK_MODEL ?? 'deepseek-chat';

function fallbackAssessment(message: string): AiAssessment {
  return {
    overallStatus: 'риск',
    summary: message,
    strengths: [],
    risks: ['AI-разбор недоступен: проверьте ключ DeepSeek API и сеть.'],
    actions: ['Добавьте VITE_DEEPSEEK_API_KEY в env и повторите запрос.']
  };
}

function localAssessment(data: DashboardData): AiAssessment {
  const load = data.forecast.loadIndexPercent ?? 100;
  const eta = data.forecast.medianEtaWeeks ?? 0;
  const quality = data.characteristics.qualityScore;
  const predictability = data.characteristics.predictabilityScore;
  const overall = data.characteristics.overallCoreScore;

  const status: AiAssessment['overallStatus'] = overall >= 80 ? 'хорошо' : overall >= 65 ? 'нормально' : 'риск';
  const summary =
    overall >= 80
      ? 'Локальная оценка: метрики выглядят устойчиво, темп и качество в рабочем балансе.'
      : overall >= 65
        ? 'Локальная оценка: рабочее состояние, но есть зоны внимания по стабильности потока или предсказуемости.'
        : 'Локальная оценка: есть риск по срокам/качеству, текущие метрики требуют корректировок процесса.';

  const strengths: string[] = [];
  const risks: string[] = [];
  const actions: string[] = [];

  if (load <= 100) strengths.push('Входящий поток задач не превышает текущую скорость закрытия.');
  else risks.push('Входящий поток задач выше скорости закрытия, хвост может расти.');

  if (quality >= 75) strengths.push('Качество на приемлемом или хорошем уровне.');
  else risks.push('Качество ниже целевого уровня, вероятны баги/переоткрытия/слабое покрытие оценкой.');

  if (predictability >= 75) strengths.push('Предсказуемость оценок выглядит стабильной.');
  else risks.push('Предсказуемость низкая: заметный разрыв между оценкой и фактом.');

  if (eta > 8) risks.push('Срок разгребания хвоста по медианному сценарию длинный.');

  actions.push('Снизить долю задач без оценки и стабилизировать оценивание.');
  actions.push('Ограничить WIP и приоритизировать закрытие залипших задач.');
  actions.push('Держать индекс загрузки ближе к 90-110%.');

  return {
    overallStatus: status,
    summary,
    strengths: strengths.slice(0, 5),
    risks: risks.slice(0, 5),
    actions: actions.slice(0, 5)
  };
}

function safeJsonParse(input: string): AiAssessment | null {
  try {
    const parsed = JSON.parse(input) as Partial<AiAssessment>;
    if (!parsed || typeof parsed !== 'object') return null;

    const overallStatus =
      parsed.overallStatus === 'хорошо' || parsed.overallStatus === 'нормально' || parsed.overallStatus === 'риск'
        ? parsed.overallStatus
        : 'нормально';

    return {
      overallStatus,
      summary: typeof parsed.summary === 'string' ? parsed.summary : 'AI не вернул саммари.',
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String).slice(0, 5) : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks.map(String).slice(0, 5) : [],
      actions: Array.isArray(parsed.actions) ? parsed.actions.map(String).slice(0, 5) : []
    };
  } catch {
    return null;
  }
}

export async function generateAiAssessment(params: {
  data: DashboardData;
  hours: WorkHoursStats;
  salaryMonth: number | null;
  earnedBySchedule: number | null;
  earnedByWorklog: number | null;
  hourlyRate: number | null;
  taskCost: number | null;
}): Promise<AiAssessment> {
  if (!deepSeekKey) {
    return localAssessment(params.data);
  }

  const payload = {
    dashboard: params.data,
    workHours: params.hours,
    finance: {
      salaryMonth: params.salaryMonth,
      earnedBySchedule: params.earnedBySchedule,
      earnedByWorklog: params.earnedByWorklog,
      hourlyRate: params.hourlyRate,
      taskCost: params.taskCost
    },
    context: {
      role: 'single_frontend_developer',
      locale: 'ru-RU'
    }
  };

  const prompt = [
    'Ты senior engineering manager и performance analyst.',
    'Сделай честный, короткий, но содержательный разбор всего дашборда разработчика.',
    'Не приукрашивай. Если есть риски по срокам/качеству/нагрузке, пиши прямо.',
    'Оцени весь дашборд: скорость, прогнозы, качество, поток, хвост, worklog-часы, финансовые метрики.',
    'Верни ТОЛЬКО JSON с полями:',
    '{"overallStatus":"хорошо|нормально|риск","summary":"...","strengths":["..."],"risks":["..."],"actions":["..."]}',
    'Ограничения: summary 4-7 предложений; strengths/risks/actions по 3-5 пунктов.',
    'Пиши на русском языке.'
  ].join(' ');

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${deepSeekKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: deepSeekModel,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: JSON.stringify(payload) }
        ]
      })
    });

    if (!response.ok) {
      const errBody = (await response.json().catch(() => null)) as
        | { error?: { code?: string; message?: string; type?: string } }
        | null;
      const code = errBody?.error?.code ?? errBody?.error?.type;
      if (code === 'insufficient_quota' || code === 'insufficient_balance') {
        return {
          ...localAssessment(params.data),
          summary:
            'Лимит/баланс DeepSeek исчерпан, поэтому показан локальный разбор на основе текущих метрик дашборда.',
          risks: [
            'Недоступен внешний AI-разбор из DeepSeek из-за ограничений лимита/баланса.',
            ...localAssessment(params.data).risks
          ].slice(0, 5),
          actions: [
            'Проверьте Billing/Usage в DeepSeek и пополните баланс.',
            ...localAssessment(params.data).actions
          ].slice(0, 5)
        };
      }
      return {
        ...localAssessment(params.data),
        summary: `DeepSeek API временно недоступен (${response.status}), показан локальный разбор.`
      };
    }

    const result = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = result.choices?.[0]?.message?.content;
    if (!content) {
      return fallbackAssessment('DeepSeek не вернул текст ответа.');
    }

    const parsed = safeJsonParse(content);
    if (!parsed) {
      return {
        ...localAssessment(params.data),
        summary: 'Ответ модели не удалось разобрать, показан локальный разбор.'
      };
    }

    return parsed;
  } catch (error) {
    return {
      ...localAssessment(params.data),
      summary: `Ошибка AI-разбора: ${error instanceof Error ? error.message : 'неизвестная ошибка'}. Показан локальный разбор.`
    };
  }
}
