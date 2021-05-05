import React, { useState } from 'react'

import { ElectionDefinition, Precinct } from '@votingworks/types'
import { Button, Prose, Loading } from '@votingworks/ui'
import { CenteredScreen } from '../components/Layout'
import { Absolute } from '../components/Absolute'
import { Bar } from '../components/Bar'
import Modal from '../components/Modal'
import {
  PrecinctScannerCardTally,
  CardTallyMetadataEntry,
  CastVoteRecord,
  TallySourceMachineType,
  MachineConfig,
} from '../config/types'

import { calculateTallyFromCVRs } from '../utils/tallies'

interface Props {
  appPrecinctId: string | undefined
  ballotsScannedCount: number
  electionDefinition: ElectionDefinition
  isPollsOpen: boolean
  isLiveMode: boolean
  togglePollsOpen: () => void
  getCVRsFromExport: () => Promise<CastVoteRecord[]>
  saveTallyToCard: (cardTally: PrecinctScannerCardTally) => Promise<void>
  machineConfig: Readonly<MachineConfig>
}

const PollWorkerScreen: React.FC<Props> = ({
  appPrecinctId,
  ballotsScannedCount,
  electionDefinition,
  isPollsOpen,
  togglePollsOpen,
  getCVRsFromExport,
  saveTallyToCard,
  isLiveMode,
  machineConfig,
}) => {
  const [isSavingTallyToCard, setIsSavingTallyToCard] = useState(false)

  const calculateAndSaveTally = async () => {
    const castVoteRecords = await getCVRsFromExport()
    const tally = calculateTallyFromCVRs(
      castVoteRecords,
      electionDefinition.election
    )
    const cardTally = {
      tallyMachineType: TallySourceMachineType.PRECINCT_SCANNER,
      totalBallotsScanned: ballotsScannedCount,
      isLiveMode,
      tally,
      metadata: [
        {
          machineId: machineConfig.machineId,
          timeSaved: Date.now(),
          ballotCount: ballotsScannedCount,
        } as CardTallyMetadataEntry,
      ],
    } as PrecinctScannerCardTally
    await saveTallyToCard(cardTally)
  }

  const { election } = electionDefinition
  const precinct = election.precincts.find(
    (p) => p.id === appPrecinctId
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
            Ballots Scanned: <strong>{ballotsScannedCount}</strong>{' '}
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
