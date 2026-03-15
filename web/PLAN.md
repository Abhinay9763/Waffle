# Waffle Web Interface — Build Plan

## Stack
- **Next.js 15** (App Router) + TypeScript
- **Tailwind CSS** + **shadcn/ui**
- **React Query** (`@tanstack/react-query`) — data fetching + polling
- **React Hook Form** + **Zod** — form validation
- **Recharts** — analytics charts
- **Sonner** — toast notifications
- **cookies-next** — cookie access in client components
- **date-fns** — date formatting
- **lucide-react** — icons

### Scaffold commands
```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --yes
npm install @tanstack/react-query recharts react-hook-form @hookform/resolvers zod date-fns sonner cookies-next lucide-react
npx shadcn@latest init
npx shadcn@latest add button card input form dialog badge table tabs select progress separator skeleton tooltip dropdown-menu sheet avatar alert label radio-group textarea popover calendar command
```

---

## Pre-Work Done
- [x] CORS middleware added to `Server/main.py` — allows `http://localhost:3000`, includes `x-session-token` header

---

## Project Structure

```
src/
├── app/
│   ├── globals.css
│   ├── layout.tsx                        # Root layout — wraps QueryProvider + SessionProvider + Toaster
│   ├── page.tsx                          # Server: reads cookie → GET /user/session → redirect by role
│   │
│   ├── (auth)/
│   │   ├── login/page.tsx                # Login page (renders LoginForm)
│   │   └── register/page.tsx             # Register page (renders RegisterForm)
│   │
│   ├── (faculty)/
│   │   ├── layout.tsx                    # Server: requireFacultySession() → faculty shell + sidebar
│   │   ├── faculty/page.tsx              # Dashboard — stat cards + recent exam table
│   │   ├── papers/
│   │   │   ├── page.tsx                  # All question papers list
│   │   │   ├── new/page.tsx              # PaperBuilder — empty
│   │   │   └── [id]/page.tsx             # PaperBuilder — pre-filled (edit)
│   │   ├── exams/
│   │   │   ├── page.tsx                  # Exam list — grouped Upcoming / Live / Ended
│   │   │   ├── new/page.tsx              # ExamScheduleForm
│   │   │   └── [id]/
│   │   │       ├── page.tsx              # Exam detail
│   │   │       └── live/page.tsx         # LiveTracker — polls every 30s
│   │   └── responses/[examId]/page.tsx   # ResponseTable + ScoreSummaryCard
│   │
│   ├── (student)/
│   │   ├── layout.tsx                    # Server: requireStudentSession() → student shell + sidebar
│   │   ├── student/page.tsx              # Dashboard — upcoming exams + last result
│   │   ├── history/page.tsx              # Past exams with scores + section breakdown
│   │   └── analytics/page.tsx            # Performance charts
│   │
│   └── api/auth/logout/route.ts          # DELETE wfl-session cookie → redirect /login
│
├── components/
│   ├── ui/                               # shadcn/ui — do not edit directly
│   │
│   ├── layout/
│   │   ├── SessionProvider.tsx           # "use client" — React context for User object
│   │   ├── QueryProvider.tsx             # "use client" — wraps children in QueryClientProvider
│   │   ├── TopBar.tsx                    # User name, role badge, logout button
│   │   ├── FacultySidebar.tsx            # Nav: Dashboard / Papers / Exams / Responses
│   │   └── StudentSidebar.tsx            # Nav: Dashboard / Exams / History / Analytics
│   │
│   ├── auth/
│   │   ├── LoginForm.tsx                 # RHF+Zod — POST /user/login → set cookie → redirect
│   │   └── RegisterForm.tsx              # RHF+Zod — POST /user/register → success message
│   │
│   ├── papers/
│   │   ├── PaperBuilder.tsx              # useReducer — full builder shell + save handler
│   │   ├── SectionEditor.tsx             # Collapsible section card with question list
│   │   ├── QuestionCard.tsx              # text, 4 options, correct radio, marks + neg-marks inputs
│   │   └── PaperPreview.tsx              # Read-only preview dialog before saving
│   │
│   ├── exams/
│   │   ├── ExamScheduleForm.tsx          # Name, paper combobox, start/end datetime pickers
│   │   ├── ExamCard.tsx                  # Name, status badge (Upcoming/Live/Ended), time window
│   │   ├── LiveTracker.tsx               # React Query polling, student status table
│   │   ├── StudentStatusRow.tsx          # Roll | Name | Status badge | Score | Submitted at
│   │   └── CountdownTimer.tsx            # Ticking display (client only)
│   │
│   ├── responses/
│   │   ├── ResponseTable.tsx             # Sortable submission table
│   │   ├── ResponseDetail.tsx            # Dialog — student answers, correct option highlighted
│   │   └── ScoreSummaryCard.tsx          # Avg / High / Low / Submitted count
│   │
│   ├── student/
│   │   ├── ExamTaker.tsx                 # Full-screen shell — localStorage auto-save per question
│   │   ├── QuestionView.tsx              # Question text + 4 radio options
│   │   ├── SectionNav.tsx                # Left panel: section list, click to jump
│   │   └── QuestionPalette.tsx           # Right panel: numbered grid (answered / marked / empty)
│   │
│   └── analytics/
│       ├── PerformanceLineChart.tsx      # Recharts LineChart — score% over last N exams
│       ├── SectionRadarChart.tsx         # Recharts RadarChart — accuracy per topic/section
│       ├── ScoreDistributionBar.tsx      # Recharts BarChart — score buckets (faculty view too)
│       └── StatCard.tsx                  # Simple card: label + big value + trend icon
│
├── lib/
│   ├── api.ts                            # ALL backend calls — typed fetch wrapper (see below)
│   ├── session.ts                        # Server-only — requireSession / requireFaculty / requireStudent
│   └── utils.ts                          # cn(), formatDate(), gradeResponse()
│
├── hooks/
│   ├── useSession.ts                     # Reads SessionProvider context
│   ├── usePolling.ts                     # Thin wrapper around React Query refetchInterval
│   └── useExamTimer.ts                   # Countdown logic, fires auto-submit callback on expiry
│
├── types/
│   └── index.ts                          # All shared TypeScript types (see below)
│
└── middleware.ts                          # Cookie-existence guard — no network call
```

---

## Types — `src/types/index.ts`

Mirrors `Server/models.py` and `Client/models.py` exactly.

```typescript
export type Role = "HOD" | "Faculty" | "Student" | "Admin";

export interface User {
  id: number;
  name: string;
  roll: string;
  role: Role;
}

// ── Question paper structures (matches Client/question.json) ──────────────────

export interface Question {
  question_id: number;
  text: string;
  options: [string, string, string, string]; // always exactly 4
  correct_option: number;                    // 0-indexed
  marks: number;
  negative_marks: number;
}

export interface Section {
  section_id: number;
  name: string;
  questions: Question[];
}

export interface ExamMeta {
  exam_name: string;
  student_roll: string | null;  // null in paper; filled at exam creation
  start_time: string;           // ISO — empty in paper; filled at exam creation
  end_time: string;
  total_marks: number;
}

export interface ExamStructure {
  meta: ExamMeta;
  sections: Section[];
}

// ── Server models ─────────────────────────────────────────────────────────────

export interface QuestionPaper {
  id?: number;
  questions: ExamStructure;            // full exam JSON
  answers: Record<number, number>;     // { question_id: correct_option_index }
  creator_id: number;
}

export interface Exam {
  id?: number;
  created_at?: string;
  name: string;
  total_marks: number;
  start: string;                       // ISO datetime
  end: string;
  creator_id: number;
  questionpaper_id: number;
}

// ── Submission structures (matches Client/models.py) ─────────────────────────

export interface QuestionResponse {
  question_id: number;
  option: number | null;               // null = unanswered
  marked: boolean;
}

export interface Submission {
  student_roll: string;
  responses: QuestionResponse[];
}

export interface ExamResponse {
  id?: number;
  submitted_at?: string;
  exam_id: number;
  user_id: number;
  response: Submission;
}

// ── Derived / computed types ──────────────────────────────────────────────────

export interface GradeResult {
  score: number;
  totalMarks: number;
  perSection: Record<string, { score: number; max: number }>;
}

export interface ExamStats {
  total_enrolled: number;
  submitted_count: number;
  average_score: number;
  highest_score: number;
  lowest_score: number;
  score_distribution: { bucket: string; count: number }[];
}

export interface StudentHistoryEntry {
  exam: Exam;
  response: ExamResponse;
  score: number;
  max_score: number;
}

// ── API payloads ──────────────────────────────────────────────────────────────

export type RegisterPayload = { name: string; email: string; password: string; roll: string; role: Role; };
export type LoginPayload    = { email: string; password: string; };
export type CreatePaperPayload = Omit<QuestionPaper, "id">;
export type CreateExamPayload  = Omit<Exam, "id" | "created_at">;
export type SubmitPayload  = { exam_id: number; response: Submission; };
```

---

## API Client — `src/lib/api.ts`

Single `apiFetch<T>()` core. Sends `x-session-token` when token is provided. Throws `ApiError(status, message)` on non-OK.

### Auth (backend: IMPLEMENTED)
| Function | Method | Path |
|---|---|---|
| `authApi.register(payload)` | POST | `/user/register` |
| `authApi.login(payload)` | POST | `/user/login` → `{ token }` |
| `authApi.getSession(token)` | GET | `/user/session` → `{ user }` |

### Question Papers (backend: NOT YET — graceful 404)
| Function | Method | Path |
|---|---|---|
| `paperApi.list(token)` | GET | `/paper/list` |
| `paperApi.create(token, data)` | POST | `/paper/create` |
| `paperApi.getById(token, id)` | GET | `/paper/{id}` |
| `paperApi.update(token, id, data)` | PUT | `/paper/{id}` |
| `paperApi.delete(token, id)` | DELETE | `/paper/{id}` |

### Exams (backend: stub only for create; rest NOT YET)
| Function | Method | Path |
|---|---|---|
| `examApi.create(token, data)` | POST | `/exam/create` |
| `examApi.list(token)` | GET | `/exam/list` |
| `examApi.getById(token, id)` | GET | `/exam/{id}` |
| `examApi.getUpcoming(token)` | GET | `/exam/upcoming` |
| `examApi.getResponses(token, examId)` | GET | `/exam/{examId}/responses` |
| `examApi.getStats(token, examId)` | GET | `/exam/{examId}/stats` |

### Responses (backend: NOT YET)
| Function | Method | Path |
|---|---|---|
| `responseApi.submit(token, data)` | POST | `/response/submit` |
| `responseApi.getMyHistory(token)` | GET | `/response/my` |

---

## Auth & Session

### `src/middleware.ts`
Cookie-existence check ONLY — no network call, no added latency.
- Public: `/login`, `/register`, `/user/auth/*`
- All other routes: require `wfl-session` cookie → redirect `/login?from=<path>`

### `src/lib/session.ts` (server-only)
- `requireSession()` — reads cookie, calls `GET /user/session`, redirects `/login` on 401
- `requireFacultySession()` — as above, redirects `/student` if role is Student
- `requireStudentSession()` — as above, redirects `/faculty` if role is not Student

### Login flow (client)
1. `POST /user/login` → UUID token
2. Set `wfl-session` cookie (30-day, SameSite=Strict)
3. `GET /user/session` → role
4. `router.replace('/faculty')` or `router.replace('/student')`

### Token in client components
`cookies-next` → `getCookie('wfl-session')` → pass to `api.ts`

---

## Key Component Notes

### PaperBuilder
- State: `useReducer` with actions `ADD_SECTION`, `REMOVE_SECTION`, `UPDATE_SECTION_NAME`, `ADD_QUESTION`, `REMOVE_QUESTION`, `UPDATE_QUESTION`
- Question IDs are **global across sections** (not per-section) — matches PyQt client convention
- On save: auto-extracts `answers: { question_id: correct_option }` from all questions
- Stores as `QuestionPaper.questions` (full `ExamStructure`) + `QuestionPaper.answers` (flat grading dict)

### LiveTracker
```typescript
useQuery({
  queryKey: ['live', examId],
  queryFn: () => examApi.getResponses(token, examId),
  refetchInterval: 30_000,
  retry: false,
})
```
Shows countdown, `X/Y submitted` progress bar, per-student status table. Renders empty state gracefully.

### ExamTaker
- Full-screen, three-panel: `SectionNav` | `QuestionView` | `QuestionPalette`
- Auto-saves to `localStorage` key `exam-progress-{examId}` on every selection
- `useExamTimer` fires auto-submit on expiry

### gradeResponse (lib/utils.ts)
```typescript
gradeResponse(
  responses: QuestionResponse[],
  answers: Record<number, number>,
  questions: Question[]
) => GradeResult
// adds marks for correct, subtracts negative_marks for wrong, 0 for unanswered
```

---

## Backend Endpoints Still Needed

| File | Endpoints to add |
|---|---|
| `routes/paper.py` (new) | `POST /paper/create`, `GET /paper/list`, `GET /paper/{id}`, `PUT /paper/{id}`, `DELETE /paper/{id}` |
| `routes/exam.py` (fix stub + expand) | Fix `POST /exam/create`, add `GET /exam/list`, `GET /exam/{id}`, `GET /exam/upcoming`, `GET /exam/{id}/responses`, `GET /exam/{id}/stats` |
| `routes/response.py` (new) | `POST /response/submit` (validate time window + no duplicate), `GET /response/my`, `GET /response/my/{examId}` |

All protected endpoints should use a shared `get_current_user(x_session_token: str = Header())` FastAPI dependency.

---

## Build Phases

| Phase | What gets built |
|---|---|
| **1 — Foundation** | `types/index.ts` → `lib/api.ts` → `middleware.ts` → `lib/session.ts` → `lib/utils.ts` → `SessionProvider` + `QueryProvider` → `layout.tsx` → `page.tsx` |
| **2 — Auth** | `LoginForm` → `RegisterForm` → `/login/page.tsx` → `/register/page.tsx` → logout route |
| **3 — Faculty shell** | `FacultySidebar` + `TopBar` → `(faculty)/layout.tsx` → faculty dashboard page |
| **4 — Papers** | `QuestionCard` → `SectionEditor` → `PaperPreview` → `PaperBuilder` → papers list + new + [id] pages |
| **5 — Exams** | `ExamScheduleForm` + `ExamCard` + `CountdownTimer` → exams list + new + detail pages |
| **6 — Live tracking** | `StudentStatusRow` → `LiveTracker` → `/exams/[id]/live/page.tsx` → `ResponseTable` + `ResponseDetail` + `ScoreSummaryCard` → responses page |
| **7 — Student shell** | `StudentSidebar` → `(student)/layout.tsx` → student dashboard page |
| **8 — Exam taking** | `QuestionPalette` → `SectionNav` → `QuestionView` → `ExamTaker` → `/exams/[id]/page.tsx` |
| **9 — History & analytics** | `StatCard` → `PerformanceLineChart` → `SectionRadarChart` → `ScoreDistributionBar` → history + analytics pages |
| **10 — Polish** | Skeletons for all pages · mobile Sheet sidebar · Sonner toasts on all mutations · error boundaries |
