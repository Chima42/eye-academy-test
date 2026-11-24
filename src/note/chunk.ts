/**
 * Turns the reference note PDF's positioned text into citable chunks.
 * Layout facts (measured from the PDF, see notes in the README):
 *   section heading 15.5pt, subheading 11.5pt, body 10.3pt, table header 8.6pt, table cells 9.2pt,
 *   running header above y=800, footer below y=30 (page number), page height ~843pt.
 */

export interface TextItem {
  str: string
  x: number
  y: number
  width: number
  size: number
}

export interface PageSpan {
  page: number
  start: number
  end: number
}

export interface Chunk {
  id: string
  section: string
  kind: 'text' | 'table_row'
  text: string
  pages: number[]
  /** Which characters of `text` came from which page, for citing the exact page of an excerpt. */
  pageSpans: PageSpan[]
}

interface Line {
  y: number
  x: number
  size: number
  text: string
  items: TextItem[]
}

interface Block {
  page: number
  section: string
  kind: 'text' | 'table_row'
  text: string
}

const isHeaderOrFooter = (it: TextItem) => it.y > 800 || it.y < 30
const H2 = (size: number) => size >= 14 && size < 20
const H3 = (size: number) => size >= 11 && size < 14
const TABLE_HEADER = (size: number) => size >= 8.55 && size < 8.9
const TABLE_CELL = (size: number) => size >= 8.9 && size < 9.8

/** Join items on one line, adding a space only where there's a visible gap. */
function joinItems(items: TextItem[]): string {
  let out = ''
  let prevEnd = -Infinity
  for (const it of items) {
    if (out && it.x > prevEnd + 1 && !out.endsWith(' ') && !it.str.startsWith(' ')) out += ' '
    out += it.str
    prevEnd = it.x + it.width
  }
  return out.replace(/\s+/g, ' ').trim()
}

/** Join wrapped lines: a trailing hyphen joins without a space ("non-pupil-" + "block"). */
function joinLines(lines: string[]): string {
  return lines.reduce((acc, l) => (!acc ? l : acc.endsWith('-') ? acc + l : `${acc} ${l}`), '')
}

function toLines(items: TextItem[]): Line[] {
  const rows = new Map<number, TextItem[]>()
  for (const it of items) {
    if (!it.str.trim() || isHeaderOrFooter(it)) continue
    const key = [...rows.keys()].find((y) => Math.abs(y - it.y) < 2) ?? it.y
    rows.set(key, [...(rows.get(key) ?? []), it])
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([y, its]) => {
      const sorted = its.sort((a, b) => a.x - b.x)
      return { y, x: sorted[0].x, size: Math.max(...sorted.map((i) => i.size)), text: joinItems(sorted), items: sorted }
    })
}

/** Split one page into blocks: paragraphs, bullets and table rows, tagged with their section. */
function pageBlocks(page: number, lines: Line[], state: { h2: string; h3: string; started: boolean }): Block[] {
  const blocks: Block[] = []
  const section = () => (state.h3 ? `${state.h2} > ${state.h3}` : state.h2)
  let para: string[] = []
  let prevY = Infinity
  let table: { columns: { name: string; x: number }[]; rows: Line[][] } | null = null

  const flushPara = () => {
    if (para.length) blocks.push({ page, section: section(), kind: 'text', text: joinLines(para) })
    para = []
  }
  const flushTable = () => {
    if (!table) return
    for (const row of table.rows) {
      const cols = table.columns.map((c, i) => {
        const next = table!.columns[i + 1]?.x ?? Infinity
        const parts = row.flatMap((l) => l.items.filter((it) => it.x >= c.x - 3 && it.x < next - 3))
        const lines = [...new Set(parts.map((p) => p.y))].sort((a, b) => b - a)
        return `${c.name}: ${joinLines(lines.map((y) => joinItems(parts.filter((p) => p.y === y))))}`
      })
      blocks.push({ page, section: section(), kind: 'table_row', text: cols.join('. ') })
    }
    table = null
  }

  for (const line of lines) {
    const gap = prevY - line.y
    prevY = line.y
    if (H2(line.size)) {
      flushPara(); flushTable()
      state.h2 = line.text; state.h3 = ''; state.started = true
      continue
    }
    if (!state.started) continue // title and tag pills before the first section
    if (H3(line.size)) {
      flushPara(); flushTable()
      state.h3 = line.text
      continue
    }
    if (TABLE_HEADER(line.size)) {
      flushPara(); flushTable()
      table = { columns: line.items.map((it) => ({ name: it.str.trim(), x: it.x })), rows: [] }
      continue
    }
    if (TABLE_CELL(line.size) && table) {
      if (table.rows.length === 0 || gap > 20) table.rows.push([line])
      else table.rows[table.rows.length - 1].push(line)
      continue
    }
    flushTable()
    // Body text: ~16.5pt between wrapped lines, ~19pt between bullets, ~25pt between paragraphs.
    if (gap > 17.8) flushPara()
    para.push(line.text)
  }
  flushPara(); flushTable()
  return blocks
}

const endsSentence = (t: string) => /[.?!:)]$/.test(t.trim())

export function chunkNote(pages: TextItem[][]): Chunk[] {
  const state = { h2: '', h3: '', started: false }
  const perPage = pages.map((items, i) => pageBlocks(i + 1, toLines(items), state))

  // Flatten, merging a paragraph that runs over a page break into one chunk with two page spans.
  const merged: { section: string; kind: Block['kind']; text: string; spans: PageSpan[] }[] = []
  perPage.forEach((blocks, pi) => {
    blocks.forEach((b, bi) => {
      const prev = merged.at(-1)
      // Bullets often lack a full stop, so also require the next page to start mid-sentence
      // (lowercase or a digit: page 6 starts "250 mg four times a day...").
      const continuesFromLastPage =
        bi === 0 && pi > 0 && prev && prev.kind === 'text' && b.kind === 'text' &&
        !endsSentence(prev.text) && /^[a-z0-9]/.test(b.text)
      if (continuesFromLastPage) {
        const start = prev.text.length + 1
        prev.text = `${prev.text} ${b.text}`
        prev.spans.push({ page: b.page, start, end: prev.text.length })
      } else {
        merged.push({ section: b.section, kind: b.kind, text: b.text, spans: [{ page: b.page, start: 0, end: b.text.length }] })
      }
    })
  })

  // Combine runs of very short bullets in the same section and page ("Female sex") so each chunk has context.
  const combined: typeof merged = []
  for (const m of merged) {
    const prev = combined.at(-1)
    const short = (t: string) => t.length < 120
    if (
      prev && m.kind === 'text' && prev.kind === 'text' && prev.section === m.section &&
      prev.spans.length === 1 && m.spans.length === 1 && prev.spans[0].page === m.spans[0].page &&
      short(m.text) && (short(prev.text) || prev.text.endsWith(':')) && prev.text.length + m.text.length < 400
    ) {
      prev.text = `${prev.text}; ${m.text}`
      prev.spans[0].end = prev.text.length
    } else combined.push({ ...m, spans: m.spans.map((s) => ({ ...s })) })
  }

  const counters = new Map<number, number>()
  return combined.map((m) => {
    const first = m.spans[0].page
    const n = (counters.get(first) ?? 0) + 1
    counters.set(first, n)
    return {
      id: `p${first}-${n}`,
      section: m.section,
      kind: m.kind,
      text: m.text,
      pages: [...new Set(m.spans.map((s) => s.page))],
      pageSpans: m.spans,
    }
  })
}

/**
 * Abbreviations the note defines on first use, e.g. "Laser peripheral iridotomy (LPI)" -> LPI.
 * Taken from the note itself, so an edited note brings its own definitions.
 */
export function findAbbreviations(texts: string[]): Map<string, string> {
  const found = new Map<string, string>()
  for (const text of texts) {
    for (const m of text.matchAll(/((?:[\w-]+\s+){0,6})\(([A-Z][A-Za-z]{1,5})\)/g)) {
      const abbr = m[2]
      if (found.has(abbr) || abbr.length < 2) continue
      const words = m[1].trim().split(/\s+/)
      for (let k = Math.min(abbr.length, words.length); k >= 1; k--) {
        const phrase = words.slice(-k)
        if (phrase[0][0]?.toLowerCase() === abbr[0].toLowerCase()) {
          found.set(abbr, phrase.join(' ').replace(/[^\w\s-]/g, ''))
          break
        }
      }
    }
  }
  return found
}

/** Text used for embedding only: bare abbreviations get their expansion appended. */
export function expandForEmbedding(text: string, abbreviations: Map<string, string>): string {
  let out = text
  for (const [abbr, long] of abbreviations) {
    out = out.replace(new RegExp(`\\b${abbr}\\b(?!\\))`, 'g'), `${abbr} (${long})`)
  }
  return out
}

/**
 * Normalise for comparison: quote styles, dashes, whitespace and case vary between the PDF text
 * and the model's copy. `map[i]` is the index in the original text of normalised character i.
 */
function normaliseWithMap(t: string): { norm: string; map: number[] } {
  let norm = ''
  const map: number[] = []
  for (let i = 0; i < t.length; i++) {
    let c = t[i]
    if (/\s/.test(c)) {
      if (norm === '' || norm.endsWith(' ')) continue // trim leading, collapse runs
      c = ' '
    } else if (c === '\u2018' || c === '\u2019') c = "'"
    else if (c === '\u201c' || c === '\u201d') c = '"'
    else if (c === '\u2013' || c === '\u2014') c = '-'
    else {
      const lower = c.toLowerCase()
      if (lower.length === 1) c = lower
    }
    norm += c
    map.push(i)
  }
  if (norm.endsWith(' ')) {
    norm = norm.slice(0, -1)
    map.pop()
  }
  return { norm, map }
}

export const normalise = (t: string): string => normaliseWithMap(t).norm

export interface LocatedExcerpt {
  /** The quote as printed in the note (not the model's copy of it). */
  text: string
  /** Every page the quote is printed on; usually one. */
  pages: number[]
}

/**
 * Find a quoted excerpt in a chunk. Returns the note's own text for it and the pages it is printed
 * on, or null if it isn't in the chunk. This is both the "is the citation real" check and the page lookup.
 */
export function locateExcerpt(chunk: Pick<Chunk, 'text' | 'pageSpans'>, excerpt: string): LocatedExcerpt | null {
  const needle = normalise(excerpt.replace(/^["“']|["”']$/g, '').replace(/\.\.\.$|…$/, ''))
  if (needle.length < 12) return null
  const { norm, map } = normaliseWithMap(chunk.text)
  const at = norm.indexOf(needle)
  if (at === -1) return null
  const start = map[at]
  const end = map[at + needle.length - 1] + 1
  const pages = chunk.pageSpans.filter((s) => s.start < end && s.end > start).map((s) => s.page)
  return { text: chunk.text.slice(start, end), pages: pages.length ? pages : [chunk.pageSpans[0].page] }
}
