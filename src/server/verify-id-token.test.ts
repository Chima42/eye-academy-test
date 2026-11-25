import { describe, expect, it } from 'vitest'
import { bearerToken, verifiedUid } from './verify-id-token'

describe('bearerToken', () => {
  it('reads the token from "Bearer <token>"', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi')
  })

  it.each([null, undefined, '', 'abc.def.ghi', 'Basic abc', 'Bearer '])('rejects %j', (header) => {
    expect(bearerToken(header)).toBeNull()
  })
})

describe('verifiedUid', () => {
  it('is null without an Authorization header, so the request is refused', async () => {
    expect(await verifiedUid(null)).toBeNull()
  })
})
