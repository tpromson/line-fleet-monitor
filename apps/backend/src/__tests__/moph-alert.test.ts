import { beforeEach, describe, expect, it, vi } from 'vitest'

import { sendMophAlert } from '../lib/moph-alert.js'

describe('moph-alert', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('skips when not enabled', async () => {
    const result = await sendMophAlert('test')
    expect(result).toEqual({ status: 'skipped', reason: 'MOPH_ALERT_ENABLED is not true' })
  })

  it('gets a token and sends a text message to configured CIDs', async () => {
    vi.stubEnv('MOPH_ALERT_ENABLED', 'true')
    vi.stubEnv('MOPH_ALERT_TOKEN_URL', 'https://token.example.test/token')
    vi.stubEnv('MOPH_ALERT_BASE_URL', 'https://alert.example.test')
    vi.stubEnv('MOPH_ALERT_USER', 'provider-user')
    vi.stubEnv('MOPH_ALERT_PASSWORD_HASH', 'password-hash')
    vi.stubEnv('MOPH_ALERT_HOSPITAL_CODE', '12345')
    vi.stubEnv('MOPH_ALERT_CIDS', '1111111111111,2222222222222')

    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'jwt-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message_code: 200 }), { status: 200 }))

    const result = await sendMophAlert('แจ้งเตือนทดสอบ')

    expect(result).toEqual({ status: 'sent' })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const tokenRequest = fetchMock.mock.calls[0]
    expect(String(tokenRequest[0])).toContain('Action=get_moph_access_token')
    expect(String(tokenRequest[0])).toContain('hospital_code=12345')

    const sendRequest = fetchMock.mock.calls[1]
    expect(sendRequest[1]).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer jwt-token',
        'Content-Type': 'application/json',
      },
    })
    expect(JSON.parse(String((sendRequest[1] as RequestInit).body))).toEqual({
      datas: ['1111111111111', '2222222222222'],
      messages: [{ type: 'text', text: 'แจ้งเตือนทดสอบ' }],
    })
  })
})
