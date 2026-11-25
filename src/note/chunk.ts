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

const isHeaderOrFooter = (item: TextItem) => item.y > 800 || item.y < 30
const isSectionHeading = (size: number) => size >= 14 && size < 20
const isSubheading = (size: number) => size >= 11 && size < 14
const isTableHeader = (size: number) => size >= 8.55 && size < 8.9
const isTableCell = (size: number) => size >= 8.9 && size < 9.8

/** Join items on one line, adding a space only where there's a visible gap. */
function joinItems(items: TextItem[]): string {
  let out = ''
  let previousEnd = -Infinity
  for (const item of items) {
    if (out && item.x > previousEnd + 1 && !out.endsWith(' ') && !item.str.startsWith(' ')) out += ' '
    out += item.str
    previousEnd = item.x + item.width
  }
  return out.replace(/\s+/g, ' ').trim()
}

/** Join wrapped lines: a trailing hyphen joins without a space ("non-pupil-" + "block"). */
function joinLines(lines: string[]): string {
  return lines.reduce((joined, line) => (!joined ? line : joined.endsWith('-') ? joined + line : `${joined} ${line}`), '')
}

function toLines(items: TextItem[]): Line[] {
  const rows = new Map<number, TextItem[]>()
  for (const item of items) {
    if (!item.str.trim() || isHeaderOrFooter(item)) continue
    const key = [...rows.keys()].find((y) => Math.abs(y - item.y) < 2) ?? item.y
    rows.set(key, [...(rows.get(key) ?? []), item])
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([y, lineItems]) => {
      const sorted = lineItems.sort((a, b) => a.x - b.x)
      return { y, x: sorted[0].x, size: Math.max(...sorted.map((item) => item.size)), text: joinItems(sorted), items: sorted }
    })
}

function pageBlocks(page: number, lines: Line[], state: { heading: string; subheading: string; started: boolean }): Block[] {
  const blocks: Block[] = []
  const section = () => (state.subheading ? `${state.heading} > ${state.subheading}` : state.heading)
  let paragraph: string[] = []
  let previousY = Infinity
  let table: { columns: { name: string; x: number }[]; rows: Line[][] } | null = null

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ page, section: section(), kind: 'text', text: joinLines(paragraph) })
    paragraph = []
  }
  const flushTable = () => {
    if (!table) return
    for (const row of table.rows) {
      const cells = table.columns.map((column, index) => {
        const next = table!.columns[index + 1]?.x ?? Infinity
        const cellItems = row.flatMap((rowLine) => rowLine.items.filter((item) => item.x >= column.x - 3 && item.x < next - 3))
        const lines = [...new Set(cellItems.map((item) => item.y))].sort((a, b) => b - a)
        return `${column.name}: ${joinLines(lines.map((y) => joinItems(cellItems.filter((item) => item.y === y))))}`
      })
      blocks.push({ page, section: section(), kind: 'table_row', text: cells.join('. ') })
    }
    table = null
  }

  for (const line of lines) {
    const gap = previousY - line.y
    previousY = line.y
    if (isSectionHeading(line.size)) {
      flushParagraph(); flushTable()
      state.heading = line.text; state.subheading = ''; state.started = true
      continue
    }
    if (!state.started) continue // title and tag pills before the first section
    if (isSubheading(line.size)) {
      flushParagraph(); flushTable()
      state.subheading = line.text
      continue
    }
    if (isTableHeader(line.size)) {
      flushParagraph(); flushTable()
      table = { columns: line.items.map((item) => ({ name: item.str.trim(), x: item.x })), rows: [] }
      continue
    }
    if (isTableCell(line.size) && table) {
      if (table.rows.length === 0 || gap > 20) table.rows.push([line])
      else table.rows[table.rows.length - 1].push(line)
      continue
    }
    flushTable()
    // Body text: ~16.5pt between wrapped lines, ~19pt between bullets, ~25pt between paragraphs.
    if (gap > 17.8) flushParagraph()
    paragraph.push(line.text)
  }
  flushParagraph(); flushTable()
  return blocks
}

const endsSentence = (text: string) => /[.?!:)]$/.test(text.trim())

export function chunkNote(pages: TextItem[][]): Chunk[] {
  const state = { heading: '', subheading: '', started: false }
  const perPage = pages.map((items, index) => pageBlocks(index + 1, toLines(items), state))

  // Flatten, merging a paragraph that runs over a page break into one chunk with two page spans.
  const merged: { section: string; kind: Block['kind']; text: string; spans: PageSpan[] }[] = []
  perPage.forEach((blocks, pageIndex) => {
    blocks.forEach((block, blockIndex) => {
      const previous = merged.at(-1)
      // Bullets often lack a full stop, so also require the next page to start mid-sentence
      // (lowercase or a digit: page 6 starts "250 mg four times a day...").
      const continuesFromLastPage =
        blockIndex === 0 && pageIndex > 0 && previous && previous.kind === 'text' && block.kind === 'text' &&
        !endsSentence(previous.text) && /^[a-z0-9]/.test(block.text)
      if (continuesFromLastPage) {
        const start = previous.text.length + 1
        previous.text = `${previous.text} ${block.text}`
        previous.spans.push({ page: block.page, start, end: previous.text.length })
      } else {
        merged.push({ section: block.section, kind: block.kind, text: block.text, spans: [{ page: block.page, start: 0, end: block.text.length }] })
      }
    })
  })

  // Combine runs of very short bullets in the same section and page ("Female sex") so each chunk has context.
  const combined: typeof merged = []
  for (const entry of merged) {
    const previous = combined.at(-1)
    const short = (text: string) => text.length < 120
    if (
      previous && entry.kind === 'text' && previous.kind === 'text' && previous.section === entry.section &&
      previous.spans.length === 1 && entry.spans.length === 1 && previous.spans[0].page === entry.spans[0].page &&
      short(entry.text) && (short(previous.text) || previous.text.endsWith(':')) && previous.text.length + entry.text.length < 400
    ) {
      previous.text = `${previous.text}; ${entry.text}`
      previous.spans[0].end = previous.text.length
    } else combined.push({ ...entry, spans: entry.spans.map((span) => ({ ...span })) })
  }

  const counters = new Map<number, number>()
  return combined.map((entry) => {
    const firstPage = entry.spans[0].page
    const count = (counters.get(firstPage) ?? 0) + 1
    counters.set(firstPage, count)
    return {
      id: `p${firstPage}-${count}`,
      section: entry.section,
      kind: entry.kind,
      text: entry.text,
      pages: [...new Set(entry.spans.map((span) => span.page))],
      pageSpans: entry.spans,
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
    for (const match of text.matchAll(/((?:[\w-]+\s+){0,6})\(([A-Z][A-Za-z]{1,5})\)/g)) {
      const abbreviation = match[2]
      if (found.has(abbreviation) || abbreviation.length < 2) continue
      const words = match[1].trim().split(/\s+/)
      for (let wordCount = Math.min(abbreviation.length, words.length); wordCount >= 1; wordCount--) {
        const phrase = words.slice(-wordCount)
        if (phrase[0][0]?.toLowerCase() === abbreviation[0].toLowerCase()) {
          found.set(abbreviation, phrase.join(' ').replace(/[^\w\s-]/g, ''))
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
  for (const [abbreviation, expansion] of abbreviations) {
    out = out.replace(new RegExp(`\\b${abbreviation}\\b(?!\\))`, 'g'), `${abbreviation} (${expansion})`)
  }
  return out
}

/**
 * Normalise for comparison: quote styles, dashes, whitespace and case vary between the PDF text
 * and the model's copy. `originalIndex[i]` is the index in the original text of normalised character i.
 */
function normaliseWithMap(text: string): { normalised: string; originalIndex: number[] } {
  let normalised = ''
  const originalIndex: number[] = []
  for (let index = 0; index < text.length; index++) {
    let character = text[index]
    if (/\s/.test(character)) {
      if (normalised === '' || normalised.endsWith(' ')) continue
      character = ' '
    } else if (character === '\u2018' || character === '\u2019') character = "'"
    else if (character === '\u201c' || character === '\u201d') character = '"'
    else if (character === '\u2013' || character === '\u2014') character = '-'
    else {
      const lower = character.toLowerCase()
      if (lower.length === 1) character = lower
    }
    normalised += character
    originalIndex.push(index)
  }
  if (normalised.endsWith(' ')) {
    normalised = normalised.slice(0, -1)
    originalIndex.pop()
  }
  return { normalised, originalIndex }
}

export const normalise = (text: string): string => normaliseWithMap(text).normalised

export interface LocatedExcerpt {
  /** The quote as printed in the note (not the model's copy of it). */
  text: string
  pages: number[]
}

/**
 * Find a quoted excerpt in a chunk. Returns the note's own text for it and the pages it is printed
 * on, or null if it isn't in the chunk. This is both the "is the citation real" check and the page lookup.
 */
export function locateExcerpt(chunk: Pick<Chunk, 'text' | 'pageSpans'>, excerpt: string): LocatedExcerpt | null {
  const needle = normalise(excerpt.replace(/^["“']|["”']$/g, '').replace(/\.\.\.$|…$/, ''))
  if (needle.length < 12) return null
  const { normalised, originalIndex } = normaliseWithMap(chunk.text)
  const position = normalised.indexOf(needle)
  if (position === -1) return null
  const start = originalIndex[position]
  const end = originalIndex[position + needle.length - 1] + 1
  const pages = chunk.pageSpans.filter((span) => span.start < end && span.end > start).map((span) => span.page)
  return { text: chunk.text.slice(start, end), pages: pages.length ? pages : [chunk.pageSpans[0].page] }
}
