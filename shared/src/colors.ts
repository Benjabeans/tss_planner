/** Course color ids. Actual values live in web/src/styles.css as CSS variables. */
export const COURSE_COLORS = ['blue', 'teal', 'green', 'olive', 'amber', 'orange', 'rose', 'magenta', 'violet', 'slate'] as const;
export type CourseColor = (typeof COURSE_COLORS)[number];

/** The least-used color, preferring palette order. */
export function nextColor(used: readonly string[]): CourseColor {
  const counts = new Map<string, number>(COURSE_COLORS.map((c) => [c, 0]));
  for (const u of used) if (counts.has(u)) counts.set(u, counts.get(u)! + 1);
  let best: CourseColor = COURSE_COLORS[0];
  for (const c of COURSE_COLORS) if (counts.get(c)! < counts.get(best)!) best = c;
  return best;
}
