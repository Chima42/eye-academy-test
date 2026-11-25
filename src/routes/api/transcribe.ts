import { createFileRoute } from '@tanstack/react-router'
import { viva } from '../../case/case'
import { keyterms, transcribe } from '../../server/deepgram'
import { signedInUid, signInRequired } from '../../server/verify-id-token'

/** About two minutes of browser Opus audio; a viva turn is a few seconds. */
const MAX_AUDIO_BYTES = 2_000_000

export const Route = createFileRoute('/api/transcribe')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await signedInUid(request))) return signInRequired()
        const declaredBytes = Number(request.headers.get('content-length') ?? 0)
        if (declaredBytes > MAX_AUDIO_BYTES) return Response.json({ error: 'Recording too long' }, { status: 413 })
        try {
          const audio = await request.arrayBuffer()
          if (audio.byteLength > MAX_AUDIO_BYTES) return Response.json({ error: 'Recording too long' }, { status: 413 })
          if (audio.byteLength === 0) return Response.json({ transcript: '' })
          const contentType = request.headers.get('content-type') ?? 'audio/webm'
          const { transcript, ms } = await transcribe({ audio, contentType }, keyterms(viva))
          return Response.json({ transcript }, { headers: { 'Server-Timing': `stt;dur=${ms.toFixed(0)}` } })
        } catch (caught) {
          console.error(caught)
          return Response.json({ error: 'Speech-to-text failed' }, { status: 502 })
        }
      },
    },
  },
})
