import { beforeEach, describe, expect, it, vi } from 'vitest'

import { sendMophNotify } from '../lib/moph-notify.js'

describe('moph-notify', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('skips when not enabled', async () => {
    const result = await sendMophNotify('test')
    expect(result).toEqual({ status: 'skipped', reason: 'MOPH_NOTIFY_ENABLED is not true' })
  })

  it('sends the PHP-compatible request with client-key and secret-key headers', async () => {
    vi.stubEnv('MOPH_NOTIFY_ENABLED', 'true')
    vi.stubEnv('MOPH_NOTIFY_URL', 'https://notify.example.test/api/notify/send')
    vi.stubEnv('MOPH_NOTIFY_CLIENT_KEY', 'client-key')
    vi.stubEnv('MOPH_NOTIFY_SECRET_KEY', 'secret-key')

    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ status: 200, message: 'Succesfully' }), { status: 200 }))

    const result = await sendMophNotify('แจ้งเตือนทดสอบ')

    expect(result).toEqual({ status: 'sent' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://notify.example.test/api/notify/send',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'client-key': 'client-key',
          'secret-key': 'secret-key',
        },
      }),
    )

    const request = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(request.body))).toEqual({
      messages: [{ type: 'text', text: 'แจ้งเตือนทดสอบ' }],
    })
  })

  it('returns a failed result for a non-2xx response', async () => {
    vi.stubEnv('MOPH_NOTIFY_ENABLED', 'true')
    vi.stubEnv('MOPH_NOTIFY_CLIENT_KEY', 'client-key')
    vi.stubEnv('MOPH_NOTIFY_SECRET_KEY', 'secret-key')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }))

    await expect(sendMophNotify('test')).resolves.toEqual({ status: 'failed', reason: 'HTTP_401' })
  })
})
