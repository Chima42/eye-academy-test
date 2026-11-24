/**
 * Preprocess the reference note once: PDF -> chunks with page spans -> local embeddings.
 * Output: data/note-chunks.json (committed, so the app needs no PDF parsing at runtime).
 * Run: npm run prepare:note
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { chunkNote, expandForEmbedding, findAbbreviations, type TextItem } from '../src/note/chunk'
import { EMBEDDING_MODEL, embed } from '../src/server/embed'

const PDF = 'data/Eye Academy - Glaucoma_and_Angle_Closure_Reference_Note.pdf'
const OUT = 'data/note-chunks.json'

const pdf = await getDocument({ data: new Uint8Array(readFileSync(PDF)) }).promise
const pages: TextItem[][] = []
for (let p = 1; p <= pdf.numPages; p++) {
  const content = await (await pdf.getPage(p)).getTextContent()
  pages.push(
    content.items
      .filter((it) => 'str' in it)
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width, size: it.transform[0] })),
  )
}

const chunks = chunkNote(pages)
// Embedded text = section heading + text with abbreviations expanded ("LPI" -> "LPI (laser
// peripheral iridotomy)"). The stored text stays verbatim for excerpt checks.
const abbreviations = findAbbreviations(chunks.map((c) => c.text))
console.log('Abbreviations defined in the note:', Object.fromEntries(abbreviations))
const vectors = await embed(
  chunks.map((c) => `${c.section}: ${expandForEmbedding(c.text, abbreviations)}`),
  'passage',
)

writeFileSync(
  OUT,
  JSON.stringify(
    {
      source: PDF,
      pages: pdf.numPages,
      embeddingModel: EMBEDDING_MODEL,
      chunks: chunks.map((c, i) => ({ ...c, embedding: vectors[i].map((v) => Number(v.toFixed(5))) })),
    },
    null,
    1,
  ),
)
console.log(`${chunks.length} chunks from ${pdf.numPages} pages -> ${OUT}`)
for (const c of chunks) console.log(`${c.id.padEnd(6)} p${c.pages.join('-').padEnd(4)} [${c.section}] ${c.text.slice(0, 90)}`)
