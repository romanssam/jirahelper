# Jira Helper Dashboard

Легкий дашборд для личной аналитики Jira: загрузка, скорость закрытия задач, качество потока, прогноз и AI-разбор.

## Короткий дескрипшн для GitHub
Jira Helper Dashboard — React/Vite приложение для персональной аналитики Jira: метрики по задачам, тренды, worklog, прогнозы и AI-оценка состояния потока.

## Что умеет
- Считать ключевые Jira-метрики по вашему аккаунту.
- Показывать тренды по месяцам (создано/закрыто/баги).
- Оценивать нагрузку, хвост задач и прогноз по закрытию.
- Показывать worklog-часы за текущий месяц.
- Делать AI-разбор метрик (через DeepSeek, если указан API key).

## Технологии
- React 18
- TypeScript
- Vite
- Recharts

## Быстрый старт
1. Установите зависимости:
```bash
npm install
```
2. Скопируйте env-шаблон:
```bash
cp .env.example .env
```
3. Заполните `.env` (минимум: Jira URL + токен + ваш email).
4. Запустите проект:
```bash
npm run dev
```
5. Откройте адрес из консоли (обычно `http://localhost:5173`).

## Переменные окружения (`.env`)

| Переменная | Обязательно | Что это |
|---|---|---|
| `VITE_JIRA_BASE_URL` | Да | Базовый URL Jira, например `https://your-company.atlassian.net` |
| `VITE_JIRA_USER_EMAIL` | Да* | Email пользователя Jira. Нужен для `basic` auth и фильтров |
| `VITE_JIRA_ASSIGNEE` | Нет | По кому считать метрики. Если пусто, берется `VITE_JIRA_USER_EMAIL` |
| `VITE_JIRA_API_TOKEN` | Да | API токен Jira |
| `VITE_JIRA_AUTH_TYPE` | Нет | `bearer` (по умолчанию) или `basic` |
| `VITE_JIRA_REOPENED_STATUSES` | Нет | Список статусов переоткрытия через запятую, например `Reopened,Returned` |
| `VITE_DEEPSEEK_API_KEY` | Нет | Ключ DeepSeek для AI-разбора |
| `VITE_DEEPSEEK_MODEL` | Нет | Модель DeepSeek, по умолчанию `deepseek-chat` |

\* Для `bearer` обычно достаточно токена, но email все равно используется в JQL-фильтрах.

## Скрипты
```bash
npm run dev      # локальная разработка
npm run build    # production-сборка
npm run preview  # просмотр production-сборки
```

## Важно
- `.env` уже в `.gitignore`, не коммитьте реальные ключи.
- Сейчас интеграция с Jira выполняется с фронтенда (MVP-подход).
