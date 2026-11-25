import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { speak } from '../../server/deepgram'
import { signedInUid, signInRequired } from '../../server/verify-id-token'

const SpeakRequestSchema = z.object({ text: z.string().min(1).max(2000) })

/** POST { text } -> streaming MP3, so the browser can start playing while the audio is still arriving. */
export const Route = createFileRoute('/api/speak')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await signedInUid(request))) return signInRequired()
        const parsed = SpeakRequestSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return Response.json({ error: 'Expected { text }' }, { status: 400 })
        try {
          const { response, msToHeaders } = await speak(parsed.data.text)
          return new Response(response.body, {
            headers: {
              'Content-Type': 'audio/mpeg',
              'Cache-Control': 'no-store',
              'Server-Timing': `tts_first_byte;dur=${msToHeaders.toFixed(0)}`,
            },
          })
        } catch (caught) {
          console.error(caught)
          return Response.json({ error: 'Text-to-speech failed' }, { status: 502 })
        }
      },
    },
  },
})
