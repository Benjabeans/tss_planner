import type { Catalog, Course } from './types.ts';
import { compareCourses, displayNumber } from './normalize.ts';

export interface SearchIndex {
  courses: Course[];
  subjects: Set<string>;
  bySubject: Map<string, Course[]>;
  hay: Map<string, { all: string; title: string; instructors: string }>;
}

export function buildSearchIndex(catalog: Catalog): SearchIndex {
  const bySubject = new Map<string, Course[]>();
  const hay = new Map<string, { all: string; title: string; instructors: string }>();
  const subjects = new Set(catalog.subjects.map((s) => s.code.toUpperCase()));
  for (const c of catalog.courses) {
    subjects.add(c.subject.toUpperCase());
    if (!bySubject.has(c.subject)) bySubject.set(c.subject, []);
    bySubject.get(c.subject)!.push(c);
    const instructors = [...new Set([...c.instructors, ...c.sections.flatMap((s) => s.instructors)])].join(' ').toLowerCase();
    const title = `${c.title} ${c.moduleTitle ?? ''}`.toLowerCase();
    hay.set(c.key, {
      all: `${c.displayCode} ${c.subject}${c.number} ${title} ${c.subjectName} ${instructors}`.toLowerCase(),
      title,
      instructors,
    });
  }
  return { courses: catalog.courses, subjects, bySubject, hay };
}

export interface CodeQuery {
  subject: string;
  number: string;
}

export interface ParsedQuery {
  codes: CodeQuery[];
  subjects: string[];
  words: string[];
}

const NUMBER_RE = /^\d{1,3}[A-Z]{0,3}$/;
const JOINED_RE = /^([A-Z]{2,5})-?(\d{1,3}[A-Z]{0,3})$/;

/**
 * "CSE 110, 120"      → codes CSE 110, CSE 120 (subject carries forward)
 * "cse110 math-18"    → codes CSE 110, MATH 18
 * "CSE"               → subject CSE
 * "griswold software" → words
 */
export function parseQuery(q: string, subjects: Set<string>): ParsedQuery {
  const codes: CodeQuery[] = [];
  const subjectsOut: string[] = [];
  const words: string[] = [];
  let carried: string | null = null;

  for (const part of q.split(/[,;]+/)) {
    const tokens = part.trim().toUpperCase().split(/\s+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      const next = tokens[i + 1];
      const joined = t.match(JOINED_RE);
      if (joined && subjects.has(joined[1]!)) {
        carried = joined[1]!;
        codes.push({ subject: carried, number: displayNumber(joined[2]!) });
        continue;
      }
      if (subjects.has(t) && next && NUMBER_RE.test(next)) {
        carried = t;
        codes.push({ subject: t, number: displayNumber(next) });
        i++;
        continue;
      }
      if (subjects.has(t) && t.length >= 2 && tokens.length === 1) {
        carried = t;
        subjectsOut.push(t);
        continue;
      }
      if (carried && NUMBER_RE.test(t)) {
        codes.push({ subject: carried, number: displayNumber(t) });
        continue;
      }
      if (subjects.has(t) && tokens.every((x) => subjects.has(x))) {
        subjectsOut.push(t);
        continue;
      }
      words.push(t.toLowerCase());
    }
  }
  return { codes, subjects: subjectsOut, words };
}

export function searchCourses(index: SearchIndex, q: string, limit = 100): Course[] {
  const parsed = parseQuery(q, index.subjects);
  const out: Course[] = [];
  const seen = new Set<string>();
  const push = (c: Course) => {
    if (seen.has(c.key)) return;
    seen.add(c.key);
    out.push(c);
  };

  for (const code of parsed.codes) {
    const pool = index.bySubject.get(code.subject) ?? [];
    const exact = pool.filter((c) => c.number.toUpperCase() === code.number);
    const matches = exact.length ? exact : pool.filter((c) => c.number.toUpperCase().startsWith(code.number));
    matches.sort(compareCourses).forEach(push);
  }

  for (const s of parsed.subjects) (index.bySubject.get(s) ?? []).forEach(push);

  if (parsed.words.length) {
    const scored: { c: Course; score: number }[] = [];
    for (const c of index.courses) {
      if (seen.has(c.key)) continue;
      const h = index.hay.get(c.key)!;
      let score = 0;
      let ok = true;
      for (const w of parsed.words) {
        if (!h.all.includes(w)) {
          ok = false;
          break;
        }
        if (new RegExp(`\\b${escapeRe(w)}`).test(h.title)) score += 3;
        else if (h.instructors.includes(w)) score += 2;
        else score += 1;
      }
      if (ok) scored.push({ c, score });
    }
    scored.sort((a, b) => b.score - a.score || compareCourses(a.c, b.c));
    for (const s of scored) {
      if (out.length >= limit) break;
      push(s.c);
    }
  }
  return out.slice(0, limit);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
