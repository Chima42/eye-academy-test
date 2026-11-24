import { createFileRoute } from '@tanstack/react-router'
import { speak } from '../../server/deepgram'

/**
 * GET /api/speak?text=... -> streaming MP3.
 * A GET URL lets an <audio> element start playing while the audio is still arriving.
 */
export const Route = createFileRoute('/api/speak')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const text = new URL(request.url).searchParams.get('text')?.slice(0, 2000)
        if (!text) return new Response('Missing text', { status: 400 })
        try {
          const { response, msToHeaders } = await speak(text)
          return new Response(response.body, {
            headers: {
              'Content-Type': 'audio/mpeg',
              'Cache-Control': 'no-store',
              'Server-Timing': `tts_first_byte;dur=${msToHeaders.toFixed(0)}`,
            },
          })
        } catch (err) {
          console.error(err)
          return new Response('Text-to-speech failed', { status: 502 })
        }
      },
    },
  },
})
