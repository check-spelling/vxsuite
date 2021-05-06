import React, { useContext, useState } from 'react'
import makeDebug from 'debug'

import { Precinct } from '@votingworks/types'
import { Button, Prose, Loading } from '@votingworks/ui'
import {
  PrecinctScannerCardTally,
  CardTallyMetadataEntry,
  TallySourceMachineType,
} from '@votingworks/utils'
import { CenteredScreen } from '../components/Layout'
import { Absolute } from '../components/Absolute'
import { Bar } from '../components/Bar'
import Modal from '../components/Modal'
import { CastVoteRecord } from '../config/types'

import { calculateTallyFromCVRs } from '../utils/tallies'
import AppContext from '../contexts/AppContext'

const debug = makeDebug('precinct-scanner:pollworker-screen')

interface Props {
  ballotsScannedCount: number
  isPollsOpen: boolean
  isLiveMode: boolean
  togglePollsOpen: () => void
  getCVRsFromExport: () => Promise<CastVoteRecord[]>
  saveTallyToCard: (cardTally: PrecinctScannerCardTally) => Promise<void>
}

const PollWorkerScreen: React.FC<Props> = ({
  ballotsScannedCount,
  isPollsOpen,
  togglePollsOpen,
  getCVRsFromExport,
  saveTallyToCard,
  isLiveMode,
}) => {
  const { electionDefinition, currentPrecinctId, machineConfig } = useContext(
    AppContext
  )
  const [isSavingTallyToCard, setIsSavingTallyToCard] = useState(false)

  const calculateAndSaveTally = async () => {
    const castVoteRecords = await getCVRsFromExport()
    const tally = calculateTallyFromCVRs(
      castVoteRecords,
      electionDefinition!.election
    )
    if (castVoteRecords.length !== ballotsScannedCount) {
      debug(
        `Warning, ballots scanned count from status endpoint (${ballotsScannedCount}) does not match number of CVRs (${castVoteRecords.length}) `
      )
    }
    const cardTally = {
      tallyMachineType: TallySourceMachineType.PRECINCT_SCANNER,
      totalBallotsScanned: castVoteRecords.length,
      isLiveMode,
      tally,
      metadata: [
        {
          machineId: machineConfig.machineId,
          timeSaved: Date.now(),
          ballotCount: castVoteRecords.length,
        } as CardTallyMetadataEntry,
      ],
    } as PrecinctScannerCardTally
    await saveTallyToCard(cardTally)
  }

  const { election } = electionDefinition!
  const precinct = election.precincts.find(
    (p) => p.id === currentPrecinctId
  ) as Precinct

  const [confirmOpenPolls, setConfirmOpenPolls] = useState(false)
  const openConfirmOpenPollsModal = () => setConfirmOpenPolls(true)
  const closeConfirmOpenPollsModal = () => setConfirmOpenPolls(false)
  const openPollsAndSaveZeroReport = async () => {
    setIsSavingTallyToCard(true)
    await calculateAndSaveTally()
    togglePollsOpen()
    setIsSavingTallyToCard(false)
    closeConfirmOpenPollsModal()
  }

  const [confirmClosePolls, setConfirmClosePolls] = useState(false)
  const openConfirmClosePollsModal = () => setConfirmClosePolls(true)
  const closeConfirmClosePollsModal = () => setConfirmClosePolls(false)
  const closePollsAndSaveTabulationReport = async () => {
    setIsSavingTallyToCard(true)
    await calculateAndSaveTally()
    togglePollsOpen()
    setIsSavingTallyToCard(false)
    closeConfirmClosePollsModal()
  }

  const precinctName = precinct === undefined ? 'All Precincts' : precinct.name

  return (
    <CenteredScreen infoBarMode="pollworker">
      <Prose textCenter>
        <h1>Poll Worker Actions</h1>
        <p>
          {isPollsOpen ? (
            <Button large onPress={openConfirmClosePollsModal}>
              Close Polls for {precinctName}
            </Button>
          ) : (
            <Button large onPress={openConfirmOpenPollsModal}>
              Open Polls for {precinctName}
            </Button>
          )}
        </p>
      </Prose>
      <Absolute top left>
        <Bar>
          <div>
            Ballots Scanned:{' '}
            <strong data-testid="ballot-count">{ballotsScannedCount}</strong>{' '}
          </div>
        </Bar>
      </Absolute>
      {confirmOpenPolls && !isSavingTallyToCard && (
        <Modal
          content={
            <Prose>
              <h1>Save Zero Report?</h1>
              <p>
                The <strong>Zero Report</strong> will be saved on the currently
                inserted poll worker card. After the report is saved on the
                card, insert the card into VxMark to print this report.
              </p>
            </Prose>
          }
          actions={
            <React.Fragment>
              <Button onPress={openPollsAndSaveZeroReport} primary>
                Save Report and Open Polls
              </Button>
              <Button onPress={closeConfirmOpenPollsModal}>Cancel</Button>
            </React.Fragment>
          }
        />
      )}
      {confirmClosePolls && !isSavingTallyToCard && (
        <Modal
          content={
            <Prose>
              <h1>Save Tabulation Report?</h1>
              <p>
                The <strong>Tabulation Report</strong> will be saved on the
                currently inserted poll worker card. After the report is saved
                on the card, insert the card into VxMark to print this report.
              </p>
            </Prose>
          }
          actions={
            <React.Fragment>
              <Button onPress={closePollsAndSaveTabulationReport} primary>
                Save Report and Close Polls
              </Button>
              <Button onPress={closeConfirmClosePollsModal}>Cancel</Button>
            </React.Fragment>
          }
        />
      )}
      {isSavingTallyToCard && (
        <Modal content={<Loading>Saving to Card</Loading>} />
      )}
    </CenteredScreen>
  )
}

export default PollWorkerScreen
