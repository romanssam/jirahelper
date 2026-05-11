# Jira Helper Dashboard

Легкий дашборд для личной аналитики Jira: загрузка, скорость закрытия задач, качество потока, прогноз и AI-разбор.

## Короткий дескрипшн для GitHub
Jira Helper Dashboard — React/Vite приложение для персональной аналитики Jira: метрики по задачам, тренды, worklog, прогнозы и AI-оценка состояния потока.

## Что умеет
- Считать ключевые Jira-метрики по вашему аккаунту.
- Показывать тренды по месяцам (создано/закрыто/баги).
- Оценивать нагрузку, хвост задач и прогноз по закрытию.
- Показывать worklog-часы за текущий месяц.
- Считать flow-метрики по changelog/worklog: cycle time, lead time, время в review/QA/blocked/уточнении, возвраты назад, срочные задачи, топ проблемных задач.
- Сохранять пользовательские введенные настройки в браузере: выбранный Jira user, период, compare users, тему, зарплату и коэффициент переработок.
- Опционально связывать Jira-задачи с self-hosted GitLab merge requests по ключам задач.
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

Если видите `Jira не авторизуется: в локальном .env стоит placeholder`, значит приложение читает локальный `.env`, но там demo/dummy значения. Замените `VITE_JIRA_BASE_URL`, `VITE_JIRA_USER_EMAIL`, `VITE_JIRA_ASSIGNEE`, `VITE_JIRA_API_TOKEN` и при необходимости `VITE_JIRA_AUTH_TYPE`.

## Переменные окружения (`.env`)

| Переменная | Обязательно | Что это |
|---|---|---|
| `VITE_JIRA_BASE_URL` | Да | Базовый URL Jira, например `https://your-company.atlassian.net` |
| `VITE_JIRA_USER_EMAIL` | Да* | Email пользователя Jira. Нужен для `basic` auth и фильтров |
| `VITE_JIRA_ASSIGNEE` | Нет | По кому считать метрики. Если пусто, берется `VITE_JIRA_USER_EMAIL` |
| `VITE_JIRA_API_TOKEN` | Да | API токен Jira |
| `VITE_JIRA_AUTH_TYPE` | Нет | `bearer` (по умолчанию) или `basic` |
| `VITE_JIRA_REOPENED_STATUSES` | Нет | Список статусов переоткрытия через запятую, например `Reopened,Returned` |
| `VITE_JIRA_IN_PROGRESS_STATUSES` | Нет | Статусы начала работы, например `In Progress,В работе` |
| `VITE_JIRA_DONE_STATUSES` | Нет | Статусы закрытия, например `Done,Готово,Closed,Resolved` |
| `VITE_JIRA_REVIEW_STATUSES` | Нет | Статусы review/code review |
| `VITE_JIRA_BLOCKED_STATUSES` | Нет | Статусы блокировки |
| `VITE_JIRA_CLARIFICATION_STATUSES` | Нет | Статусы уточнения деталей |
| `VITE_JIRA_QA_STATUSES` | Нет | Статусы QA/acceptance |
| `VITE_JIRA_PLANNED_CLOSE_FIELD` | Нет | Поле плановой даты закрытия. По умолчанию `duedate`, так как спринтов нет |
| `VITE_JIRA_EPIC_LINK_FIELD` | Нет | Поле epic link. Часто `customfield_10008`, но в вашей Jira может отличаться |
| `VITE_JIRA_DETAILED_MAX_PAGES` | Нет | Лимит страниц детальной выборки по 50 задач для changelog/worklog, по умолчанию `10` |
| `VITE_GITLAB_BASE_URL` | Нет | URL self-hosted GitLab, например `https://git.eka.wellsoft.pro` |
| `VITE_GITLAB_TOKEN` | Нет | Personal/project/group access token GitLab с правами на чтение merge requests |
| `VITE_GITLAB_PROJECT_IDS` | Нет | Список GitLab project id через запятую. Если пусто, приложение пробует `/api/v4/merge_requests` |
| `VITE_GITLAB_MAX_PAGES` | Нет | Сколько страниц MR читать из GitLab, по умолчанию `4` |
| `VITE_DEEPSEEK_API_KEY` | Нет | Ключ DeepSeek для AI-разбора |
| `VITE_DEEPSEEK_MODEL` | Нет | Модель DeepSeek, по умолчанию `deepseek-chat` |

\* Для `bearer` обычно достаточно токена, но email все равно используется в JQL-фильтрах.

## Скрипты
```bash
npm run dev      # локальная разработка
npm run build    # production-сборка
npm run preview  # просмотр production-сборки
```

## Расширенные Jira-метрики

Во вкладке `Аналитика` есть блок расширенного flow-анализа. Он строится по задачам, которые были на выбранном assignee и были созданы, обновлены или закрыты внутри выбранного периода.

Реализованные пункты:
- `In Progress → Done`: среднее и медиана дней от первого входа в рабочий статус до Done/resolution.
- `Создание → закрытие`: среднее и медиана дней от `created` до `resolutiondate`.
- Текущие открытые задачи: сколько дней они уже находятся в работе.
- Время в статусах review, blocked, уточнение деталей, QA/acceptance.
- Сколько задач добавилось, переоткрылось и изменилось внутри периода.
- Сколько планировалось закрыть и сколько реально закрыто. Без спринтов план берется из `VITE_JIRA_PLANNED_CLOSE_FIELD`, по умолчанию `duedate`.
- Сколько разных проектов, компонентов и эпиков трогались за период.
- Доля длинной непрерывной работы против мелких переключений. Это эвристика по worklog: длинная работа считается по worklog-стрику от 2 дней или суммарному worklog от 4 часов.
- Доля urgent/hotfix/production/high-priority задач среди закрытых.
- Доля задач, которые возвращались назад из Done/Review/QA в рабочие или reopened-статусы.
- Топ задач, которые портят метрики: самые долгие, переоцененные, недооцененные и залипшие.
- Список задач без оценки, но с фактически списанным временем.

Ограничения:
- Названия статусов сильно зависят от workflow. Проверьте env-переменные со списками статусов под вашу Jira.
- Детальная выборка ограничена `VITE_JIRA_DETAILED_MAX_PAGES`, чтобы не уронить браузер и Jira большим количеством changelog/worklog-запросов.
- Если в Jira нет `duedate` или отдельного поля плановой даты, метрика planned/actual будет показывать только фактическое закрытие.

## Интеграция с GitLab

Self-hosted GitLab можно подключить так:

```env
VITE_GITLAB_BASE_URL=https://git.eka.wellsoft.pro
VITE_GITLAB_TOKEN=glpat_xxxxxxxxxxxxxxxxxxxx
VITE_GITLAB_PROJECT_IDS=123,456
VITE_GITLAB_MAX_PAGES=4
```

Токену нужны права на чтение merge requests. Обычно достаточно `read_api`.

Как происходит связь с Jira:
- приложение берет ключи задач из текущей Jira-выборки, например `ABC-123`;
- читает GitLab merge requests, обновленные внутри периода;
- ищет ключи Jira в `title`, `description`, `source_branch`, `target_branch`;
- показывает, сколько MR связано с задачами, сколько merged/opened и какие Jira-ключи чаще встречаются.

Если `VITE_GITLAB_PROJECT_IDS` пустой, используется общий endpoint `/api/v4/merge_requests`. На self-hosted GitLab он может требовать широких прав. Надежнее указать project id нужных репозиториев.

## Важно
- `.env` уже в `.gitignore`, не коммитьте реальные ключи.
- Сейчас интеграция с Jira выполняется с фронтенда (MVP-подход).
- `.env.example` должен содержать только плейсхолдеры, реальные Jira/GitLab/AI токены храните только в локальном `.env`.
- После изменения `.env` перезапустите `npm run dev`, Vite не всегда подхватывает новые env-переменные на лету.
