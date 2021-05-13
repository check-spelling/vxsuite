import React from 'react'
import { fireEvent, render, act, waitFor } from '@testing-library/react'
import { MemoryStorage, MemoryCard, MemoryHardware } from '@votingworks/utils'

import App from './App'

import {
  advanceTimers,
  advanceTimersAndPromises,
  getNewVoterCard,
} from '../test/helpers/smartcards'

import {
  presidentContest,
  setElectionInStorage,
  setStateInStorage,
} from '../test/helpers/election'
import { fakeMachineConfigProvider } from '../test/helpers/fakeMachineConfig'

jest.useFakeTimers()

beforeEach(() => {
  window.location.href = '/'
})

it('Single Seat Contest', async () => {
  // ====================== BEGIN CONTEST SETUP ====================== //

  const card = new MemoryCard()
  const hardware = await MemoryHardware.buildStandard()
  const storage = new MemoryStorage()
  const machineConfig = fakeMachineConfigProvider()

  setElectionInStorage(storage)
  setStateInStorage(storage)

  const { container, getByText } = render(
    <App
      card={card}
      hardware={hardware}
      storage={storage}
      machineConfig={machineConfig}
    />
  )
  await advanceTimersAndPromises()

  // Insert Voter Card
  card.insertCard(getNewVoterCard())
  advanceTimers()

  // Go to First Contest
  await waitFor(() => fireEvent.click(getByText('Start Voting')))
  advanceTimers()

  // ====================== END CONTEST SETUP ====================== //

  const candidate0 = presidentContest.candidates[0].name
  const candidate1 = presidentContest.candidates[1].name

  getByText(presidentContest.title)

  // Select first candiate
  fireEvent.click(getByText(candidate0))

  // Select second candidate
  fireEvent.click(getByText(candidate1))

  // Overvote modal is displayed
  getByText(
    `You may only select ${presidentContest.seats} candidate in this contest. To vote for ${candidate1}, you must first unselect the selected candidate.`
  )

  // Capture styles of Single Candidate Contest
  expect(container.firstChild).toMatchSnapshot()

  // Close the modal
  fireEvent.click(getByText('Okay'))

  // First candidate is selected
  expect(getByText(candidate0).closest('button')!.dataset.selected).toBe('true')

  // Second candidate is NOT selected
  expect(getByText(candidate1).closest('button')!.dataset.selected).toBe(
    'false'
  )

  // Deselect the first candidate
  fireEvent.click(getByText(candidate0))

  // Check that the aria label was updated to be include 'deselected' and is then updated back to the original state
  expect(
    getByText(candidate0).closest('button')?.getAttribute('aria-label')
  ).toContain('Deselected,')
  expect(
    getByText(candidate1).closest('button')?.getAttribute('aria-label')
  ).not.toContain('Deselected,')
  act(() => {
    jest.advanceTimersByTime(101)
  })
  expect(
    getByText(candidate0).closest('button')?.getAttribute('aria-label')
  ).not.toContain('Deselected,')
})
