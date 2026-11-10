# TSS Planner: Design

A WebReg-style weekly calendar planner for UC San Diego courses. It runs on public data from the Triton Student System (TSS) era. You plan here, then book in TSS (sis.ucsd.edu).

Status: phases 1–5 implemented and phase 6 scaffolded (Docker/Caddy, not yet run on a VPS). Last revised 2026-11-09 (UI polish pass: §5).

---

## 1. Goals and non-goals

**Goals**
- Make it fast to answer "which section combinations fit my week?" This is the job WebReg's calendar did well.
- Show what a section does to your week **before** you add it (hover preview).
- Make conflicts obvious, explain them, and suggest a fix (see §6).
- Compare multiple plans per term. Hand the final plan off to TSS with copyable section IDs.
- Run locally first, then on a VPS with one Docker container.

**Non-goals for v1**
- Booking or enrolling. TSS is the only system that can do that, and we never hold TSS credentials.
- Room/building data and CAPES. Neither is in the public data (see §2.4).
- Degree audit or prerequisite checking. We display prereq text but don't evaluate it.

---

## 2. Data source

### 2.1 Upstream
UCSD's official Class Planner (`https://classplanner.apps.ucsd.edu`) exposes an unauthenticated JSON API:

| Endpoint | Use |
|---|---|
| `GET /api/v1/public/catalog/terms` | Term list plus `last_full_refresh_at` (the change detector) |
| `GET /api/v1/public/catalog/filters?term_code=XX` | Subject list with labels |
| `POST /api/v1/public/catalog/courses/search` | Course → sections → meetings. Body: `{term_code, q, limit ≤ 48, offset, sort}` |

A full term is about 2,400 course listings, 7,500 sections and 11,700 meetings. That takes about 50 requests and comes to ~7.6 MB raw (~0.6 MB gzipped). Paginate with `sort: "course_code"` so the order is stable.

### 2.2 Data facts observed (WI27, 2026-11-09)
- **Course numbers are zero-padded** (`MATH-018`, `MAE-011`, `MATH-003B`). We display them unpadded (`MATH 18`) and match user input against the unpadded form.
- **One module code can appear several times.** This happens with topic courses (`ANTH 212` "Human Neuroanatomy" vs "Stem Cells…") and section families (`COGS 160` family 001/002). A course listing's identity is `module_code | section_family | course_title`.
- **Section codes** always match `NNN-NNN-XX`: a group, a sub-number and an instruction type. `000` is the group's primary component.
- **Instruction types** include lecture, discussion, lab and seminar, plus `in` (independent study), `cl` clinical, `tu` tutorial, `pr` practicum, `st` studio, `co` conference, `fw` fieldwork, `ot` other and `it` internship.
- **Meeting kinds:** `class` (weekly), `final`, `midterm`, `other`. The last three carry a `specific_date`. 138 `class` meetings are also one-offs with a date.
- **TBA:** 2,961 meetings have no day or time (`is_tba`). Saturday and Sunday meetings exist (86 Sat, 2 Sun).
- **Status:** `AC` (active) or `waitlist_only`. Waitlist counts are often null.
- **No location fields.** `section_text` sometimes includes a room in free text.

### 2.3 Event packages (how TSS books)
TSS (SAP Student Lifecycle Management) books a **package**, which is a bundle of required components (e.g. LE + DI + LA). Dropping a package drops all of its parts. A package is the unit you choose in this planner, replacing WebReg's A01/A02 rows.

We derive packages like this, and it reproduces the API's own `complete_package_count`:
1. **When sections carry `event_package_ids`:** invert the lists to get package → sections. A package is *complete* when it covers every instruction type that **its section group** (e.g. `004`) has among packaged sections. Groups can differ: one lecture might come with labs and another without (FA26 BILD 4). Partial packages (LE-only, LA-only) are hidden. Sections with no packages, such as an optional FW, are shown as notes on the course.
2. **When no section has package IDs, or none is complete:** use the section-code structure. For each group, `000` plus each child sub-number (`001`, `002`, …) is one package. A group with no children is just its `000` section.
3. **Aliases:** upstream often has several package IDs that bundle the identical set of sections (about 3,100 extra IDs in WI27, probably separate seat pools). For planning they are one choice. The lowest ID is primary and the rest are `altIds`. Lookups match either, and each pick also stores its section IDs, so it survives upstream renumbering.

Including aliases, this reproduces the upstream `complete_package_count` for every course in FA26 and WI27, with three exceptions where upstream is internally inconsistent: ECE 121B, HILD 7A and MAE 156A (see `shared/test/normalize.test.ts`).

Example: CSE 110 (WI27) has three complete packages. Each is LE 001-000 + DI 001-001 + one of three labs.

### 2.4 Known gaps and risks
- **The API is undocumented.** All upstream calls go through `server/src/upstream/ucsd.ts`. If that layer gets an unexpected shape, it throws a clear error, and the last good catalog keeps being served.
- **Room/building and CAPES** need login, so they're out of scope.
- **Seat counts are informational.** The UI says so and links to TSS.

### 2.5 Academic calendar (hard-coded, `shared/src/terms.ts`)
Used for `.ics` export and the term header. Source: UCSD 2026–27 academic calendar.

| Term | Instruction | Finals | Holidays |
|---|---|---|---|
| FA26 | Sep 24 – Dec 4, 2026 | Dec 5 – 12 | Nov 11, Nov 26–27 |
| WI27 | Jan 4 – Mar 12, 2027 | Mar 13 – 20 | Jan 18, Feb 15 |
| SP27 | Mar 29 – Jun 4, 2027 | Jun 5 – 11 | May 31 |

Unit caps (undergrad): 11.5 at first pass, 19.5 at second pass, 22 from the first day of instruction. Waitlisted courses count toward the cap.

---

## 3. Architecture

```
          ┌───────────── server (Node 26, Hono) ─────────────┐
UCSD API ─┤ upstream/ucsd.ts → normalize (shared) → store    ├─ /api/terms
          │ sync scheduler: poll terms 15m, refetch on change │  /api/terms/:code/catalog  (ETag, gzip)
          │ + seat refresh every 60m                          │  /api/sync/status
          └───────────────────────────────────────────────────┘  static web/dist in prod
                                   │
                                   ▼
          ┌──────────────── web (React 19 + Vite) ───────────┐
          │ loads whole term catalog once (~0.6 MB gz)        │
          │ search index, package lookup, conflict engine     │
          │ (all in-memory, all instant)                      │
          │ plans → localStorage (v1) → server DB (VPS phase) │
          └───────────────────────────────────────────────────┘
```

**Why a server instead of calling UCSD from the browser:** CORS, being a polite client (one sync job instead of many browsers), and instant client-side search over the full term.

**Why ship the whole term to the client:** about 7.5k sections fit easily in memory. Search, previews and conflict checks then run in under 16 ms with no network round-trips. That responsiveness is what made WebReg feel good.

### 3.1 Stack
| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript everywhere, erasable syntax only | Node 26 runs `.ts` directly, so the server needs no build step |
| Shared logic | `shared/` (pure functions, no DOM) | Normalizer, packages, conflicts, layout, search, ICS. Unit-tested once and used by both server and web |
| Server | Node 26 + Hono + `@hono/node-server` | Small, fast, easy to deploy |
| Catalog store | JSON files in `data/` (normalized and raw snapshots) | Simplest correct option. SQLite (`node:sqlite`) arrives with server-side plans and accounts |
| Web | React 19, Vite, Tailwind v4, Zustand (`persist`) | Fast dev loop. Zustand persists plans to localStorage |
| Calendar | Custom CSS-grid component | Full control over ghost previews, lanes, conflict hatching and the finals view |
| Fonts | IBM Plex Sans + IBM Plex Sans Condensed (self-hosted via @fontsource) | Tabular numerals for times. The condensed face fits course labels in narrow blocks |
| Tests | Vitest (shared and server), Playwright (smoke and screenshots) | |
| Deploy | One Docker image + Caddy on the VPS | |

### 3.2 Repo layout
```
tss_planner/
  DESIGN.md  README.md  package.json (npm workspaces; Node 26 runs server .ts directly)
  shared/src/   types.ts normalize.ts packages.ts time.ts conflicts.ts layout.ts
                search.ts ics.ts terms.ts colors.ts index.ts
  shared/test/  *.test.ts + fixtures/
  server/src/   index.ts app.ts sync.ts store.ts upstream/ucsd.ts
  web/src/      main.tsx App.tsx store/ components/ lib/
  data/         (gitignored) catalog/<TERM>.json, raw/<TERM>/<ts>.json.gz, meta.json
```

---

## 4. Data model

```ts
// ---- catalog (server → client, normalized) ----
Term        { code: 'WI27', name: 'Winter 2027', refreshedAt, syncedAt, dates?: TermDates }
Catalog     { term: Term, courses: Course[], subjects: {code,name}[] }
Course      { key /* 'CSE-110||' */, subject: 'CSE', number: '110', displayCode: 'CSE 110',
              title, subjectName, level: 'LD'|'UD'|'GR', units: '4 units', unitsMin, unitsMax,
              prereqs: string[], restrictions: string[], fees: string[], notes: string[],
              isTopic: boolean, family: string | null,
              sections: Section[], packages: Package[] }
Section     { id: 'E 00006964', code: '001-000-LE', group: '001', sub: '000', type: 'LE',
              typeName: 'Lecture', instructors: string[], capacity, enrolled, seatsAvailable,
              waitlist: { capacity, enrolled, available } | null, status: 'open'|'full'|'waitlist_only',
              meetings: Meeting[], text: string[] }
Meeting     { kind: 'class'|'final'|'midterm'|'other', day: 0..6 | null, date: 'YYYY-MM-DD' | null,
              start: number /*min*/ | null, end: number | null, tba: boolean, remote: boolean }
Package     { id: '165071' | 'g:001-001', sectionIds: string[], seatsAvailable /*min over parts*/,
              status: 'open'|'full'|'waitlist_only' }

// ---- user plans (client; later server) ----
Plan        { id, termCode, name, picks: Pick[], blocks: CustomBlock[], createdAt, updatedAt }
Pick        { courseKey, packageId, color: ColorId, status: 'planned'|'enrolled'|'waitlisted'|'backup',
              fingerprint /* hash of meetings at add-time */, addedAt }
CustomBlock { id, label, days: number[], start, end, color }
```

---

## 5. UI

### 5.1 Layout (desktop ≥ 1024 px)
```
+--------------------------------------------------------------------------+
| TSS Planner  [Winter 2027 v]  [Plan A v]     16 units  [2 conflicts] [...]|
+-------------------------+------------------------------------------------+
| Search: CSE 110, MATH 18| [Week | Finals]  Previewing...  [Find a schedule]|
| [x] Open seats only     |        Mon     Tue     Wed     Thu     Fri     |
| [ ] Hide conflicting    |  9am  +-----+         +-----+         +-----+  |
|-------------------------|       |MATH |         |MATH |         |MATH |  |
| CSE 110 Software Eng 4u |       | 18  |         | 18  |         | 18  |  |
|  Griswold - 195 open    | 10am  +-----+         +-----+         +-----+  |
|  LE MWF 12:00-12:50     |  ...                                           |
|   ( ) LA 001  M 3:00p   | 12pm  :.....:         :.....:         :.....:  |
|   (o) LA 002  M 3:00p <-|       :CSE  :  ghost  :CSE  :         :CSE  :  |
|   ( ) LA 003  M 3:00p   |       :110  : preview :110  :         :110  :  |
|   [ Add to plan ]       |  3pm  :LA 2 :                                  |
|                         | Not on calendar: CSE 199 (TBA)                 |
+-------------------------+------------------------------------------------+
| Course  Type Sec  Days  Time         Instructor  Seats  Status  Section ID|
| CSE 110 LE   001  MWF   12:00-12:50  Griswold    195    Planned E 00006964|
+--------------------------------------------------------------------------+
```
- **Search panel (left):** a query box, filters (open seats, hide conflicting, level, days, earliest and latest time), and results grouped by course. Expanding a course lists its **packages** as rows (components, days and times, instructor, seats). Each row shows a **conflict chip** when it overlaps the current plan.
- **Hovering a package row** (or focusing it with the keyboard) draws it on the calendar as ghost blocks. Overlaps are hatched red. Clicking adds the package, and clicking a different package of a course already in the plan swaps it.
- **Calendar (center):** Mon–Fri by default. Sat/Sun columns appear automatically when needed. The time range auto-fits from 8am–6pm and grows to cover planned blocks (minimum range 8am–5pm). Blocks show the course code, type and time, top-aligned. Labels adapt to the block's own width (a container query): the full range when the block is wide, the start time when it is narrow (phones, conflict lanes), and type and range stacked when it is also tall. Clicking a block opens the course sheet (swap, color, status, remove), and that course's blocks stay highlighted while the sheet is open.
- **Calendar toolbar:** the Week/Finals toggle, a preview line ("Previewing CSE 110"), and **Find a schedule**, the primary action, on the right. It is disabled until the plan has a non-backup course.
- **Find a schedule (desktop):** opens in the left column in place of search. The search query is kept and `/` returns to it. Nothing covers the calendar, so options and the calendar sit side by side. The panel has the courses with lock toggles, rules (days off, time window, open seats only), a "Prefer" ranking and up to 10 options. Hovering an option previews it on the calendar. Clicking (or focusing) picks it: the card expands to list each section that moves, old → new (`ECON 1 DI  ~~M 5:00–5:50pm~~ → M 6:00–6:50pm`), and a **Use this schedule** button. Picked options stay previewed. While the finder is open, the toolbar shows a pager (‹ ›, a **Your plan | Option N** toggle, "of 10", Use this schedule) so you can step through options, or flip between an option and the plan as it is, while looking at the calendar. Applying closes the finder, with Undo in the toast. It can also be opened from the conflict center.
- **Comparing with the plan as it is:**
  - **Baseline card.** A dashed **Your plan** card sits above the options, with the same numbers (days on campus, time between classes, first start to last end, full/waitlisted) plus its conflict count, counted the way the header pill counts them. Hovering it shows the plan; clicking it pins the plan.
  - **Differences on each option.** Each option card adds a line of differences from the plan, e.g. "fixes 2 conflicts · 1 fewer day on campus · 40m less between classes · starts 1h later". Improvements are green, regressions amber, and start/end shifts neutral, since earlier vs later is a matter of taste. The numbers come from the plan as it would be after applying the option (`shared/src/compare.ts`), so they never disagree with the header afterwards.
  - **Calendar diff.** Sections an option keeps stay solid. Only sections that change are ghosts, and each section moving away leaves a dashed, struck-through outline where it is now. Outlines draw over solid blocks, because a section leaving a conflict sat on top of another class, but under the ghosts. The same diff applies to every preview, including hovering a search result for a course already in the plan.
  - **Stable grid.** While the finder is open, the week view spans the hours of every option, so flipping doesn't change the calendar's height.
- **Sheets** (course, conflict center, blocked time, settings) open over the left column, below the header, so the header and calendar stay visible. Opening one moves keyboard focus into it, and closing it returns focus.
- **Finals view:** a toggle that replaces the weekly grid with finals-week columns (one per date, e.g. Sat Mar 13 – Sat Mar 20) showing only `final` meetings. Midterms and one-off events appear in a list under the calendar.
- **Plan table (bottom):** the plan name and unit total, Copy all IDs, Block off time, then one row per component with copy buttons for section IDs (for booking in TSS), a status picker, and a per-course conflict explanation.
- **Header:** term, plan switcher (new, duplicate, share link, rename, delete), a units total colored against the cap, a conflict pill that opens the conflict center, and a More menu (export .ics, print, block off time, settings). Menus work with the arrow keys.
- **Toasts** sit at the bottom center of the main column (not over the search panel). Each carries Undo, plus Fix when the change created a conflict.

### 5.2 Mobile (< 1024 px)
Three bottom tabs: **Search · Calendar · Plan**. The header wraps to two rows, and the unit total moves into the plan header.
- **Search:** tapping a section adds it, with Undo in the toast. There is no hover preview.
- **Calendar:** the whole week (Mon–Fri) with a narrow hour gutter. Narrow blocks show the code, type and start time, e.g. "MATH 18 / LE 11:00". The toolbar holds Week/Finals and Find a schedule.
- **Find a schedule:** a phone can't show the option list and the calendar at once. The list opens full screen, and tapping an option returns to the Calendar tab with that option previewed and a pager above the tab bar (Your plan | Option N toggle, the differences line, ‹ ›, All options, Use this schedule, close). Tapping the Your plan card shows the plan with the same pager. Leaving the Calendar tab ends the preview.
- **Plan:** a stacked list instead of the wide table. Each section shows its type, code, time, instructor and seats, and its section ID is a tap-to-copy button.

### 5.3 Visual design tokens
- **Concept:** a timetable on a clean desk. It's a quiet, dense, legible utility. All of the visual boldness goes into the course blocks and the conflict treatment. Nothing else is decorated.
- **Color (light):** paper `#F6F7F9`, surface `#FFFFFF`, ink `#16213A` (deep navy), muted `#5A6478`, rule `#DCE0E7`, accent gold `#E3A21A` (focus, selection, primary action), conflict red `#D2362B`.
- **Course palette:** 10 hues (blue, teal, green, olive, amber, orange, rose, magenta, violet, slate), each with a light fill, a strong edge and text tones. Dark-mode equivalents included.
- **Type:** IBM Plex Sans 400/500/600 for UI, with `tabular-nums` for all times and seat counts. IBM Plex Sans Condensed 500/600 for text inside calendar blocks.
- **Motion:** only in response to the user, such as blocks settling into place when added and the conflict pulse when focused from the conflict center. `prefers-reduced-motion` is respected.

---

## 6. Conflicts: detection, display and resolution

The planner **never blocks** an add. A planner exists to explore, and you might plan a conflict on purpose (a backup course, or a lecture you'll podcast). Instead, every conflict is **visible before the add, explained after, and resolvable in one click**.

### 6.1 What counts as a conflict
Two meetings overlap if they occur on the same day and `a.start < b.end && b.start < a.end`. Touching (12:50 end, 12:50 start) is **not** an overlap. Meetings with `tba`, or with a null day or time, never conflict. They're listed under "Not on calendar".

| # | Kind | Example | Severity |
|---|---|---|---|
| C1 | Class ↔ class (weekly) | CSE 110 LE MWF 12:00 vs MATH 18 DI W 12:00 | **error** |
| C2 | Class ↔ dated event | CHEM 6B midterm Mon Feb 1 7pm vs a weekly Mon 7pm discussion | warning |
| C3 | Final ↔ final (same date) | two finals Wed Mar 17 11:30am | **error** (finals view) |
| C3b | Exam ↔ exam (midterm/final, same date) | two midterms Wed Feb 3 7pm | **error** |
| C4 | Class ↔ custom block | lab vs "Work" block Tue 2–5pm | warning |
| C5 | Tight transition (< 10 min gap, same day) | ends 10:50, next starts 10:55 | info |
| — | Involving a **backup** pick | any of the above | downgraded to info (warning if the other side is **enrolled**) |
| — | Same course twice | adding a 2nd package of CSE 110 | not a conflict: it's a **swap** |

When an **enrolled** pick is involved, the conflict center labels it ("enrolled course"), and a backup that overlaps an enrolled course stays a warning instead of dropping to a note.

**"Fits"** in swap lists and the generator means no error *and* no warning, so a section that runs into your Work block doesn't count as a fix.

Other plan warnings that aren't time conflicts, shown in the same center:
- **Full / waitlist-only package** (warning). You'd be waitlisted, and waitlisted units still count toward the cap.
- **Units over cap** (warning). Compared against the configurable cap: 22 by default, with first- and second-pass presets of 11.5 and 19.5.
- **Section changed or removed upstream** (warning). Each pick stores a fingerprint of its meetings, so after a sync we can tell whether the times changed or the package disappeared. The pick is kept and flagged "Times changed: MWF 12:00 → TuTh 11:00" or "No longer offered".

### 6.2 Before adding (prevention)
- Every package row in search results shows a chip such as `Conflicts with MATH 18`, computed against the active plan, excluding backups.
- The hover/focus preview draws ghost blocks. The overlapping minutes get a red hatched band, so you can see *exactly* which part collides.
- The "Hide conflicting" filter removes packages that would create an error-level conflict, and courses where *every* package conflicts collapse to "All sections conflict with your plan".

### 6.3 When you add anyway
- The pick is added with no modal dialog.
- A toast says what happened: "Added CSE 110. Overlaps MATH 18 DI on Wed 12:00–12:50", with **Undo** and **Fix** buttons.
- The calendar splits the overlapping blocks side-by-side into **lanes** (the interval-graph layout from §7.3). Each block involved gets a red edge, and the exact overlapping interval gets a hatched red band.
- The header pill switches to `1 conflict` (red). The plan table rows show ⚠ with the explanation.

### 6.4 Resolving (conflict center and Fix)
Clicking a conflicted block, the toast's **Fix** or the header pill opens the **conflict center**, which lists each conflict pair. For each side it offers:
1. **Swap section:** other complete packages of the same course that **clear this conflict without creating a new one**, sorted by open seats. Hovering one previews it, and clicking swaps it.
2. **Mark as backup:** keeps the course visible but dashed and translucent. Backups don't count toward units, and their conflicts downgrade to info. This is useful for "if I don't get off the waitlist".
3. **Move to another plan:** removes it here and adds it to a new or chosen plan, e.g. "Plan B".
4. **Remove.**

If no package of either course clears the conflict, the center says so plainly: "No section of CSE 110 avoids MATH 18. Pick one course, mark one as backup, or split them across plans."

### 6.5 Finals view
Finals and other dated exams are checked separately, by date. A finals conflict (C3) doesn't turn the weekly calendar red. It shows as a separate `Finals conflict` badge in the header and in the conflict center: "Final exams overlap on Wed Mar 17. Talk to both instructors early."

---

## 7. Core algorithms (`shared/`)

### 7.1 Normalize
Turn upstream JSON into `Course[]`. This step:
- strips zero-padding from the display number
- derives course keys
- maps instruction-type codes to labels (from the section-code suffix)
- builds packages (§2.3)
- computes the seat status of each package

### 7.2 Conflict engine
`findConflicts(entries, opts) → Conflict[]`. Entries are picks expanded into meetings, plus custom blocks. Meetings are bucketed by weekday or date, then each bucket is swept in sorted order, comparing every meeting with those still active. A plan has fewer than about 100 meetings, so this is effectively O(n log n). The same function powers the chips, the previews, the conflict center, "hide conflicting" and the future generator.

### 7.3 Calendar lanes
For each day, sort blocks by start time and split them into clusters of transitively overlapping blocks. Within a cluster, greedily give each block the first lane that's free. A block's width is `1 / lanesInCluster`. Ghost blocks join the layout so a preview shows exactly where things would land.

### 7.4 Search
Client-side, over an index built once per catalog:
- Query parser: `CSE 110, 120` → `[CSE 110, CSE 120]` (the subject carries forward). `cse110`, `MATH 18` and `math-18` all match `MATH-018`. A bare subject (`CSE`) gives every CSE course. Anything else does a token match across title, instructor and subject name.
- Ranking order: exact code, then code prefix, then title or instructor token matches, then the rest.
- Results render as a virtualized list and only expand sections on demand.

### 7.5 Schedule generator
`generateSchedules({courses, fixed, constraints, preference})` runs a depth-first search over each course's packages. It starts with the course that has the fewest usable packages and prunes on hard conflicts: class, final and custom-block overlaps. Midterm and dated-meeting overlaps are allowed but noted. Locked and enrolled courses and custom blocks are passed in as `fixed`. Results are ranked by a weighted score covering days on campus, gap minutes, minutes before 10am and full/waitlisted packages. The score covers the whole week: locked courses count toward days and gaps, so "fewest days" ranks correctly when some courses are locked. The preference (balanced, fewest days, fewest gaps, start later) picks the weights. The search stops after a node budget (150k) and reports that it did. When nothing fits, it explains why: either a course has no package that passes the filters (or avoids the fixed items), or it names the course pairs that can never coexist. For example, in WI27 every CSE 110 lab (Mon 3:00–5:50pm) overlaps CSE 100's only discussion (Mon 4:00–4:50pm).

### 7.6 ICS export
Each package's weekly class meetings become a `VEVENT` with `RRULE:FREQ=WEEKLY;BYDAY=…;UNTIL=<instruction end>`. The first occurrence is aligned to the first matching weekday on or after instruction begins, and holidays become `EXDATE`s. Finals and midterms are single events. Times use TZID `America/Los_Angeles` with a VTIMEZONE block.

---

## 8. Server details

- `npm run sync -- WI27` runs a one-shot sync. `npm run dev` starts the server with the scheduler enabled.
- **Scheduler:** every 15 minutes it fetches `/terms`. A term is re-synced if it's new, its `last_full_refresh_at` changed, or its last sync was more than 60 minutes ago. The rule is at most one request in flight, with about 700 ms between requests. The User-Agent identifies the app.
- **Sync writes** go to a temp file and are then atomically renamed into `data/catalog/<TERM>.json`. The raw snapshot is gzipped to `data/raw/<TERM>/<iso>.json.gz` (keeping the last 5).
- **Validation:** each response is checked for the fields we rely on. If the check fails, the sync aborts, the previous catalog stays live, and `/api/sync/status` reports the error.
- **Routes:** `GET /api/health`, `GET /api/terms`, `GET /api/terms/:code/catalog` (ETag based on syncedAt, gzip), `GET /api/sync/status`, and `POST /api/sync/:code` (localhost only).

---

## 9. Phases

| Phase | Scope | Done when |
|---|---|---|
| **1. Data** | shared normalize, packages and tests; server upstream, sync, store and routes | `npm test` is green and `/api/terms/WI27/catalog` serves a normalized term |
| **2. Calendar core** | grid, lanes, blocks, plan store (persisted), add/remove/swap, colors, finals view | Picks render correctly, including Sat and lanes |
| **3. Search and preview** | query parser, index, results, package rows, ghost preview, conflict chips, filters | Typing `CSE 110, MATH 18` and hovering previews instantly |
| **4. Conflicts** | conflict engine wired up, header pill, toast with undo/fix, conflict center, backup status | All of §6 works |
| **5. Plan management and export** | multiple plans, duplicate/rename, custom blocks, plan table, copy IDs, `.ics` export, print view | |
| **6. Deploy** | Dockerfile, Caddy example (done); server-side plans in SQLite, accounts (todo) | Runs on the VPS |
| **7. Later** | ~~schedule generator~~ (done: `shared/src/generate.ts` + the "Find a schedule" panel), seat-open alerts, share links, server-side plans | |

---

## 10. Testing strategy
- **Unit (Vitest, `shared/`):** normalizer against a real fixture. Package derivation must reproduce the upstream `complete_package_count` for every course in the fixture. Also covered: the conflict engine (every case in §6.1), lanes, the query parser and ICS output.
- **Server:** sync against a mocked upstream (happy path, schema drift, network failure leaving the old catalog live).
- **E2E (Playwright):** load the app, search, hover-preview, add, then add a conflicting course and verify the pill, lanes and Fix → swap path. Screenshots at desktop and mobile widths in light and dark mode.
