// End-to-end smoke test + screenshots. Needs the dev servers running (npm run dev).
//   node e2e/smoke.mjs            → http://localhost:5173
//   BASE=http://localhost:8787 node e2e/smoke.mjs   (production build)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.env.BASE ?? 'http://localhost:5173';
const out = new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const errors = [];
const steps = [];
const step = (s) => {
  steps.push(s);
  console.log(`✓ ${s}`);
};

async function newPage(opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base);
  await page.waitForLoadState('networkidle');
  return page;
}

try {
  // ---------------------------------------------------------------- desktop, light
  const page = await newPage({
    viewport: { width: 1440, height: 940 },
    colorScheme: 'light',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await page.getByText('Your week is empty').waitFor();
  await page.screenshot({ path: `${out}01-empty.png` });
  step('loads with an empty week');

  const search = page.getByPlaceholder('CSE 110, MATH 18, or a professor');
  await search.fill('CSE 110');
  const cseRow = page.getByRole('button', { name: /^Add CSE 110/ }).first();
  await cseRow.hover();
  await page.getByText(/Previewing/).waitFor();
  await page.screenshot({ path: `${out}02-hover-preview.png` });
  step('hovering a section previews it');

  await cseRow.click();
  await page.getByText('Added CSE 110.').waitFor();
  await page.mouse.move(900, 900);
  step('adds CSE 110');

  await search.fill('ECON 1');
  const conflictRow = page.getByRole('button', { name: /Add ECON 1 .*Conflicts with CSE 110/ }).first();
  await conflictRow.hover();
  await page.screenshot({ path: `${out}03-conflict-preview.png` });
  step('search shows a conflict chip + red preview for ECON 1 at 12pm');

  await conflictRow.click();
  await page.getByRole('button', { name: /1 conflict/ }).waitFor();
  await page.mouse.move(900, 900);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}04-conflict-added.png` });
  step('adding anyway shows lanes, the header pill, and a Fix toast');

  await page.getByRole('button', { name: /1 conflict/ }).click();
  await page.getByText(/thing to sort out/).waitFor();
  await page.getByRole('button', { name: 'Swap section' }).nth(1).click();
  await page.screenshot({ path: `${out}05-conflict-center.png` });
  step('conflict center lists swap options');

  await page.getByRole('button', { name: /Fits/ }).first().click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /No conflicts/ }).waitFor();
  await page.mouse.move(900, 900);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}06-resolved.png` });
  step('swapping ECON 1 resolves the conflict');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('button', { name: 'More actions' }).click();
      await page.getByRole('menuitem', { name: /Export to calendar/ }).click();
    })(),
  ]);
  const ics = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'));
  if (!ics.includes('BEGIN:VEVENT') || !ics.includes('RRULE:FREQ=WEEKLY')) throw new Error('ics export looks wrong');
  step(`exports .ics (${download.suggestedFilename()}, ${ics.split('BEGIN:VEVENT').length - 1} events)`);

  await page.getByRole('tab', { name: 'Finals' }).click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}07-finals.png` });
  await page.getByRole('tab', { name: 'Week' }).click();
  step('finals view renders');

  await page.getByRole('button', { name: 'Block off time' }).click();
  await page.getByRole('button', { name: 'Add to plan' }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}08-with-block.png`, fullPage: true });
  step('custom block added');

  // Plan persists across reloads.
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: /No conflicts|conflict|warning/ }).first().waitFor();
  const courses = await page.getByText(/2 courses/).count();
  if (courses < 1) throw new Error('plan did not persist across reload');
  step('plan persists across reload');

  await page.getByRole('button', { name: 'Switch plan' }).click();
  await page.getByRole('menuitem', { name: /Copy share link/ }).click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  if (!link.includes('#share=')) throw new Error(`unexpected share link: ${link}`);
  const friend = await newPage({ viewport: { width: 1440, height: 940 } });
  await friend.goto(link);
  await friend.getByText(/Imported “Plan A” as a new plan/).waitFor();
  await friend.getByText('Plan A (shared)').first().waitFor();
  if (friend.url().includes('#share=')) throw new Error('share hash was not cleared');
  step('share link imports the plan in a fresh browser');

  // ---------------------------------------------------------------- generator
  const gen = await newPage({ viewport: { width: 1440, height: 940 }, colorScheme: 'light' });
  const gs = gen.getByPlaceholder('CSE 110, MATH 18, or a professor');
  for (const [q, re] of [
    ['CSE 110', /^Add CSE 110/],
    ['ECON 1', /Add ECON 1 .*Conflicts with CSE 110/],
    ['MATH 18', /^Add MATH 18/],
  ]) {
    await gs.fill(q);
    await gen.getByRole('button', { name: re }).first().click();
  }
  await gen.getByRole('button', { name: /conflict/ }).first().waitFor();
  // The finder opens in the left column, so the calendar stays visible while options are previewed.
  await gen.getByRole('button', { name: 'Find a schedule' }).click();
  await gen.getByRole('heading', { name: 'Find a schedule' }).waitFor();
  if (await gen.getByPlaceholder('CSE 110, MATH 18, or a professor').isVisible()) throw new Error('finder should replace the search panel');
  const option = gen.getByRole('button', { name: /^Option 1 / });
  await option.hover();
  await gen.getByText(/Previewing/).first().waitFor();
  await gen.locator('.cal-block[data-ghost]').first().waitFor();
  await gen.screenshot({ path: `${out}13-generator-preview.png` });
  await option.click();
  // Comparing with the plan: the card says what the option fixes, the calendar outlines where moved
  // sections are now, and the toggle flips the calendar back to the plan as it is.
  await gen.getByText(/fixes \d+ conflicts?/).first().waitFor();
  if ((await gen.locator('.cal-was').count()) === 0) throw new Error('expected outlines where moved sections sit now');
  await gen.getByRole('button', { name: 'Your plan', exact: true }).click();
  await gen.waitForFunction(() => document.querySelectorAll('.cal-block[data-ghost], .cal-was').length === 0);
  await gen.locator('.conflict-band').first().waitFor();
  await gen.getByRole('button', { name: 'Option 1', exact: true }).click();
  await gen.locator('.cal-block[data-ghost]').first().waitFor();
  await gen.mouse.move(1000, 900);
  await gen.screenshot({ path: `${out}16-generator-compare.png` });
  await gen.getByRole('button', { name: 'Use this schedule' }).first().click();
  await gen.getByRole('button', { name: /No conflicts/ }).waitFor();
  if (await gen.getByRole('heading', { name: 'Find a schedule' }).count()) throw new Error('finder should close after applying');
  await gen.mouse.move(1000, 900);
  await gen.waitForTimeout(2200);
  await gen.screenshot({ path: `${out}14-generator-applied.png` });
  step('generator compares an option with the plan, then applies it');

  // ---------------------------------------------------------------- dark
  const dark = await newPage({ viewport: { width: 1440, height: 940 }, colorScheme: 'dark' });
  const ds = dark.getByPlaceholder('CSE 110, MATH 18, or a professor');
  await ds.fill('CSE 110');
  await dark.getByRole('button', { name: /^Add CSE 110/ }).first().click();
  await ds.fill('ECON 1');
  await dark.getByRole('button', { name: /Add ECON 1 .*Conflicts with CSE 110/ }).first().click();
  await dark.mouse.move(900, 900);
  await dark.waitForTimeout(300);
  await dark.screenshot({ path: `${out}09-dark-conflict.png` });
  step('dark mode renders');

  // ---------------------------------------------------------------- mobile
  const mobile = await newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'light', isMobile: true, hasTouch: true });
  const ms = mobile.getByPlaceholder('CSE 110, MATH 18, or a professor');
  await ms.fill('MATH 18');
  await mobile.screenshot({ path: `${out}10-mobile-search.png` });
  await mobile.getByRole('button', { name: /^Add MATH 18/ }).first().click();
  await mobile.locator('nav[aria-label=Sections] button', { hasText: 'Calendar' }).click();
  await mobile.waitForTimeout(200);
  await mobile.screenshot({ path: `${out}11-mobile-calendar.png` });
  await mobile.locator('nav[aria-label=Sections] button', { hasText: 'Plan' }).click();
  await mobile.screenshot({ path: `${out}12-mobile-plan.png` });
  step('mobile tabs work');

  // Phones can't show the option list and the calendar together: picking an option shows it on the calendar.
  await mobile.locator('nav[aria-label=Sections] button', { hasText: 'Calendar' }).click();
  await mobile.getByRole('button', { name: 'Find a schedule' }).click();
  await mobile.getByRole('button', { name: /^Option 1 / }).click();
  await mobile.getByRole('group', { name: 'Compare with your plan' }).waitFor();
  await mobile.locator('.cal-block[data-ghost]').first().waitFor();
  await mobile.screenshot({ path: `${out}15-mobile-finder.png` });
  await mobile.getByRole('button', { name: 'Your plan', exact: true }).click();
  await mobile.waitForFunction(() => document.querySelectorAll('.cal-block[data-ghost]').length === 0);
  await mobile.getByRole('button', { name: 'Option 1', exact: true }).click();
  await mobile.locator('.cal-block[data-ghost]').first().waitFor();
  await mobile.getByRole('button', { name: 'Use this schedule' }).click();
  await mobile.getByText(/Applied Option 1|Option 1 matches your plan already/).waitFor();
  step('mobile finder previews an option, flips to the plan and back, and applies it');
} catch (err) {
  console.error('✗ FAILED after:', steps.at(-1) ?? '(start)');
  console.error(err);
  process.exitCode = 1;
} finally {
  if (errors.length) {
    console.error('\nBrowser console errors:');
    for (const e of errors) console.error('  ', e);
    process.exitCode = 1;
  }
  await browser.close();
}
