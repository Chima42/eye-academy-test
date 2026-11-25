import { createFileRoute } from '@tanstack/react-router'
import { viva } from '../../case/case'
import { keyterms, transcribe } from '../../server/deepgram'

export const Route = createFileRoute('/api/transcribe')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const audio = await request.arrayBuffer()
          if (audio.byteLength === 0) return Response.json({ transcript: '' })
          const contentType = request.headers.get('content-type') ?? 'audio/webm'
          const { transcript, ms } = await transcribe(audio, contentType, keyterms(viva))
          return Response.json({ transcript }, { headers: { 'Server-Timing': `stt;dur=${ms.toFixed(0)}` } })
        } catch (err) {
          console.error(err)
          return Response.json({ error: 'Speech-to-text failed' }, { status: 502 })
        }
      },
    },
  },
})
