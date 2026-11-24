/** Print what retrieval returns for a few queries. Run: npx tsx scripts/try-retrieval.ts "query" ... */
import { retrieve } from '../src/note/retrieve'
const queries = process.argv.slice(2).length ? process.argv.slice(2) : [
  'Why the fellow (left) eye also needs a laser peripheral iridotomy',
  'Why pilocarpine may not work at first when the intraocular pressure is very high',
  'What to do if the intraocular pressure does not come down with medical treatment',
  'Check for sulfonamide allergy before giving acetazolamide',
  'Stopping the anticholinergic antihistamine chlorphenamine that triggered the attack',
]
for (const q of queries) {
  console.log(`\nQ: ${q}`)
  for (const { chunk, score } of await retrieve(q)) console.log(`  ${score.toFixed(3)}  ${chunk.id.padEnd(6)} p${chunk.pages.join('-')}  [${chunk.section}] ${chunk.text.slice(0, 70)}`)
}
