/**
 * The only module that talks to UCSD. The API is undocumented, so every response is
 * shape-checked; a mismatch throws UpstreamShapeError and the last good catalog stays live.
 */
import type { RawCourse, RawSubject, RawTerm } from '../../../shared/src/types.ts';

export class UpstreamShapeError extends Error {
  override name = 'UpstreamShapeError';
}

export interface UpstreamOptions {
  baseUrl: string;
  userAgent: string;
  requestDelayMs: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const PAGE_SIZE = 48; // upstream maximum

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class UcsdClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly opts: UpstreamOptions;

  constructor(opts: UpstreamOptions) {
    this.opts = opts;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  private async request(path: string, init: RequestInit = {}, attempt = 1): Promise<unknown> {
    const url = `${this.opts.baseUrl}${path}`;
    try {
      const res = await this.fetchImpl(url, {
        ...init,
        headers: { Accept: 'application/json', 'User-Agent': this.opts.userAgent, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status} from ${path}`);
      if (!res.ok) throw new UpstreamShapeError(`HTTP ${res.status} from ${path}`);
      const type = res.headers.get('content-type') ?? '';
      if (!type.includes('json')) throw new UpstreamShapeError(`Expected JSON from ${path}, got ${type || 'no content-type'}`);
      return await res.json();
    } catch (err) {
      if (err instanceof UpstreamShapeError || attempt >= 3) throw err;
      await this.sleep(1000 * 2 ** attempt);
      return this.request(path, init, attempt + 1);
    }
  }

  async terms(): Promise<RawTerm[]> {
    const body = (await this.request('/api/v1/public/catalog/terms')) as { terms?: unknown };
    if (!Array.isArray(body?.terms)) throw new UpstreamShapeError('terms: missing "terms" array');
    for (const t of body.terms) {
      if (typeof t?.term_code !== 'string') throw new UpstreamShapeError('terms: entry without term_code');
    }
    return body.terms as RawTerm[];
  }

  async subjects(termCode: string): Promise<RawSubject[]> {
    const body = (await this.request(
      `/api/v1/public/catalog/filters?${new URLSearchParams({ term_code: termCode })}`,
    )) as { subjects?: unknown };
    if (!Array.isArray(body?.subjects)) throw new UpstreamShapeError('filters: missing "subjects" array');
    return (body.subjects as RawSubject[]).filter((s) => typeof s?.value === 'string');
  }

  /** Every course listing of a term, paginated in stable course-code order. */
  async allCourses(termCode: string, onProgress?: (done: number, total: number) => void): Promise<RawCourse[]> {
    const courses: RawCourse[] = [];
    let total = Infinity;
    for (let offset = 0; offset < total; offset += PAGE_SIZE) {
      if (offset > 0) await this.sleep(this.opts.requestDelayMs);
      const body = (await this.request('/api/v1/public/catalog/courses/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ term_code: termCode, q: '', sort: 'course_code', direction: 'asc', offset, limit: PAGE_SIZE }),
      })) as { total?: unknown; courses?: unknown };
      if (typeof body?.total !== 'number' || !Array.isArray(body.courses)) {
        throw new UpstreamShapeError('search: missing "total" or "courses"');
      }
      total = body.total;
      for (const c of body.courses) validateCourse(c);
      courses.push(...(body.courses as RawCourse[]));
      onProgress?.(Math.min(offset + PAGE_SIZE, total), total);
      if (body.courses.length === 0) break;
    }
    return courses;
  }
}

function validateCourse(c: any): void {
  const need = ['module_code', 'subject_code', 'course_code', 'sections'];
  for (const k of need) if (c?.[k] === undefined) throw new UpstreamShapeError(`course missing "${k}"`);
  if (!Array.isArray(c.sections)) throw new UpstreamShapeError(`${c.module_code}: sections is not an array`);
  for (const s of c.sections) {
    if (typeof s?.section_id !== 'string' || typeof s?.section_code !== 'string' || !Array.isArray(s?.meetings)) {
      throw new UpstreamShapeError(`${c.module_code}: malformed section`);
    }
    if (!Array.isArray(s.event_package_ids)) s.event_package_ids = [];
    for (const m of s.meetings) {
      if (typeof m?.meeting_kind !== 'string' || !('start_minutes' in m)) {
        throw new UpstreamShapeError(`${c.module_code} ${s.section_code}: malformed meeting`);
      }
    }
  }
}
