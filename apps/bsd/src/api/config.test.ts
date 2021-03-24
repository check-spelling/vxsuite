import fetchMock from 'fetch-mock'
import { electionSampleDefinition as testElectionDefinition } from '@votingworks/fixtures'
import * as config from './config'

test('GET /config', async () => {
  fetchMock.getOnce(
    '/config',
    JSON.stringify({
      electionDefinition: testElectionDefinition,
      testMode: true,
    })
  )
  expect(await config.get()).toEqual({
    electionDefinition: testElectionDefinition,
    testMode: true,
  })
})

test('PATCH /config/electionDefinition', async () => {
  fetchMock.patchOnce(
    '/config/electionDefinition',
    JSON.stringify({ status: 'ok' })
  )
  await config.setElectionDefinition(testElectionDefinition)
})

test('PATCH /config/electionDefinition fails', async () => {
  fetchMock.patchOnce(
    '/config/electionDefinition',

    new Response(JSON.stringify({ status: 'error', error: 'bad election!' }), {
      status: 400,
    })
  )
  await expect(
    config.setElectionDefinition(testElectionDefinition)
  ).rejects.toThrowError(
    'PATCH /config/electionDefinition failed: bad election!'
  )
})

test('DELETE /config/electionDefinition to delete election', async () => {
  fetchMock.deleteOnce(
    '/config/electionDefinition',
    JSON.stringify({ status: 'ok' })
  )
  await config.setElectionDefinition(undefined)
})
