import React, { useEffect, useState, useCallback } from 'react'
import { Route, Switch, useHistory } from 'react-router-dom'
import {
  ElectionDefinition,
  MarkThresholds,
  Optional,
  safeParseJSON,
  UserSession,
} from '@votingworks/types'
import styled from 'styled-components'

import {
  ScannerStatus,
  GetScanStatusResponse,
  GetScanStatusResponseSchema,
  ScanBatchResponseSchema,
  ScanContinueRequest,
  ScanContinueResponseSchema,
  ZeroResponseSchema,
} from '@votingworks/types/api/module-scan'
import {
  usbstick,
  KioskStorage,
  LocalStorage,
  Card,
  Hardware,
} from '@votingworks/utils'
import {
  useUsbDrive,
  USBControllerButton,
  useSmartcard,
  SetupCardReaderPage,
} from '@votingworks/ui'
import { MachineConfig } from './config/types'
import AppContext from './contexts/AppContext'

import Button from './components/Button'
import Main, { MainChild } from './components/Main'
import Screen from './components/Screen'
import Prose from './components/Prose'
import Text from './components/Text'
import ScanButton from './components/ScanButton'
import useInterval from './hooks/useInterval'

import LoadElectionScreen from './screens/LoadElectionScreen'
import DashboardScreen from './screens/DashboardScreen'
import BallotEjectScreen from './screens/BallotEjectScreen'
import AdvancedOptionsScreen from './screens/AdvancedOptionsScreen'

import 'normalize.css'
import './App.css'
import download from './util/download'
import * as config from './api/config'
import LinkButton from './components/LinkButton'
import MainNav from './components/MainNav'
import StatusFooter from './components/StatusFooter'

import ExportResultsModal from './components/ExportResultsModal'
import machineConfigProvider from './util/machineConfig'
import { MachineLockedScreen } from './screens/MachineLockedScreen'
import { InvalidCardScreen } from './screens/InvalidCardScreen'
import { UnlockMachineScreen } from './screens/UnlockMachineScreen'

const Buttons = styled.div`
  padding: 10px 0;
  & * {
    margin-right: 10px;
  }
`

export interface AppRootProps {
  card: Card
  hardware: Hardware
}

const App = ({ card, hardware }: AppRootProps): JSX.Element => {
  const history = useHistory()
  const [isConfigLoaded, setIsConfigLoaded] = useState(false)
  const [
    electionDefinition,
    setElectionDefinition,
  ] = useState<ElectionDefinition>()
  const [electionJustLoaded, setElectionJustLoaded] = useState(false)
  const [isTestMode, setTestMode] = useState(false)
  const [isTogglingTestMode, setTogglingTestMode] = useState(false)
  const [status, setStatus] = useState<GetScanStatusResponse>({
    batches: [],
    adjudication: { remaining: 0, adjudicated: 0 },
    scanner: ScannerStatus.Unknown,
  })

  const [machineConfig, setMachineConfig] = useState<MachineConfig>({
    machineId: '0000',
    bypassAuthentication: false,
  })
  const [currentUserSession, setCurrentUserSession] = useState<UserSession>()

  const usbDrive = useUsbDrive()

  const [smartcard, hasCardReaderAttached] = useSmartcard({ card, hardware })
  useEffect(() => {
    void (async () => {
      setCurrentUserSession((prev) => {
        if (machineConfig.bypassAuthentication && !prev) {
          return {
            type: 'admin',
            authenticated: true,
          }
        }

        if (smartcard) {
          if (!prev?.authenticated && smartcard.data?.t) {
            return {
              type: smartcard.data.t,
              authenticated: false,
            }
          }
        } else if (prev && !prev.authenticated) {
          // If a card is removed when there is not an authenticated session, clear the session.
          return undefined
        }

        return prev
      })
    })()
  }, [machineConfig, smartcard])

  const attemptToAuthenticateUser = useCallback(
    (passcode: string): boolean => {
      let isAdminCard = false
      let passcodeMatches = false

      // The card must be an admin card to authenticate
      if (smartcard?.data?.t === 'admin') {
        isAdminCard = true
        // There must be an expected passcode on the card to authenticate.
        if (typeof smartcard.data.p === 'string') {
          passcodeMatches = passcode === smartcard.data.p
        }
      }

      setCurrentUserSession(
        isAdminCard
          ? { type: 'admin', authenticated: passcodeMatches }
          : undefined
      )
      return isAdminCard && passcodeMatches
    },
    [smartcard]
  )

  const lockMachine = useCallback(() => {
    if (!machineConfig.bypassAuthentication) {
      setCurrentUserSession(undefined)
    }
  }, [machineConfig.bypassAuthentication])

  const [isExportingCVRs, setIsExportingCVRs] = useState(false)

  const [markThresholds, setMarkThresholds] = useState<
    Optional<MarkThresholds>
  >()

  const { adjudication } = status

  const [isScanning, setIsScanning] = useState(false)

  const refreshConfig = useCallback(async () => {
    setElectionDefinition(await config.getElectionDefinition())
    setTestMode(await config.getTestMode())
    setMarkThresholds(await config.getMarkThresholdOverrides())
  }, [])

  const updateElectionDefinition = async (e: Optional<ElectionDefinition>) => {
    setElectionDefinition(e)
    setElectionJustLoaded(true)
  }

  useEffect(() => {
    const initialize = async () => {
      try {
        await refreshConfig()
        setIsConfigLoaded(true)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('failed to initialize:', e)
        window.setTimeout(initialize, 1000)
      }
    }

    void initialize()
  }, [refreshConfig])

  useEffect(() => {
    const initialize = async () => {
      try {
        const newMachineConfig = await machineConfigProvider.get()
        setMachineConfig(newMachineConfig)
      } catch (e) {
        // TODO: what should happen in machineConfig not returned?
      }
    }

    void initialize()
  }, [setMachineConfig])

  const updateStatus = useCallback(async () => {
    try {
      const body = await (await fetch('/scan/status')).text()
      const newStatus = safeParseJSON(
        body,
        GetScanStatusResponseSchema
      ).unsafeUnwrap()
      setStatus((prevStatus) => {
        if (JSON.stringify(prevStatus) === JSON.stringify(newStatus)) {
          return prevStatus
        }
        setIsScanning(
          newStatus.adjudication.remaining === 0 &&
            newStatus.batches.some(({ endedAt }) => !endedAt)
        )
        return newStatus
      })
    } catch (error) {
      setIsScanning(false)
      console.log('failed updateStatus()', error) // eslint-disable-line no-console
    }
  }, [setStatus])

  const unconfigureServer = useCallback(async () => {
    try {
      await config.setElection(undefined)
      await refreshConfig()
      history.replace('/')
    } catch (error) {
      console.log('failed unconfigureServer()', error) // eslint-disable-line no-console
    }
  }, [history, refreshConfig])

  const scanBatch = useCallback(async () => {
    setIsScanning(true)
    try {
      const result = safeParseJSON(
        await (
          await fetch('/scan/scanBatch', {
            method: 'post',
          })
        ).text(),
        ScanBatchResponseSchema
      ).unsafeUnwrap()
      if (result.status !== 'ok') {
        // eslint-disable-next-line no-alert
        window.alert(`could not scan: ${JSON.stringify(result.errors)}`)
        setIsScanning(false)
      }
    } catch (error) {
      console.log('failed handleFileInput()', error) // eslint-disable-line no-console
    }
  }, [])

  const continueScanning = useCallback(async (request: ScanContinueRequest) => {
    setIsScanning(true)
    try {
      safeParseJSON(
        await (
          await fetch('/scan/scanContinue', {
            method: 'post',
            body: JSON.stringify(request),
            headers: {
              'Content-Type': 'application/json',
            },
          })
        ).text(),
        ScanContinueResponseSchema
      ).unsafeUnwrap()
    } catch (error) {
      console.log('failed handleFileInput()', error) // eslint-disable-line no-console
    }
  }, [])

  const zeroData = useCallback(async () => {
    try {
      safeParseJSON(
        await (
          await fetch('/scan/zero', {
            method: 'post',
          })
        ).text(),
        ZeroResponseSchema
      ).unsafeUnwrap()
      await refreshConfig()
      history.replace('/')
    } catch (error) {
      console.log('failed zeroData()', error) // eslint-disable-line no-console
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history])

  const backup = useCallback(async () => {
    await download('/scan/backup')
  }, [])

  const toggleTestMode = useCallback(async () => {
    try {
      setTogglingTestMode(true)
      await config.setTestMode(!isTestMode)
      await refreshConfig()
      history.replace('/')
    } finally {
      setTogglingTestMode(false)
    }
  }, [history, isTestMode, refreshConfig])

  const setMarkThresholdOverrides = useCallback(
    async (markThresholdOverrides: Optional<MarkThresholds>) => {
      await config.setMarkThresholdOverrides(markThresholdOverrides)
      await refreshConfig()
      history.replace('/')
    },
    [history, refreshConfig]
  )

  const deleteBatch = useCallback(async (id: string) => {
    await fetch(`/scan/batch/${id}`, {
      method: 'DELETE',
    })
  }, [])

  useInterval(
    useCallback(async () => {
      if (electionDefinition) {
        await updateStatus()
      }
    }, [electionDefinition, updateStatus]),
    1000
  )

  const displayUsbStatus = usbDrive.status ?? usbstick.UsbDriveStatus.absent

  useEffect(() => {
    void updateStatus()
  }, [updateStatus])

  useEffect(() => {
    if (
      electionJustLoaded &&
      displayUsbStatus === usbstick.UsbDriveStatus.recentlyEjected
    ) {
      setElectionJustLoaded(false)
    }
  }, [electionJustLoaded, displayUsbStatus])

  const storage = window.kiosk
    ? new KioskStorage(window.kiosk)
    : new LocalStorage()

  if (!hasCardReaderAttached) {
    return <SetupCardReaderPage />
  }

  if (!currentUserSession) {
    return (
      <AppContext.Provider
        value={{
          usbDriveStatus: displayUsbStatus,
          usbDriveEject: usbDrive.eject,
          electionDefinition,
          machineConfig,
          storage,
          lockMachine,
        }}
      >
        <MachineLockedScreen />
      </AppContext.Provider>
    )
  }

  if (currentUserSession.type !== 'admin') {
    return (
      <AppContext.Provider
        value={{
          usbDriveStatus: displayUsbStatus,
          usbDriveEject: usbDrive.eject,
          electionDefinition,
          machineConfig,
          storage,
          lockMachine,
        }}
      >
        <InvalidCardScreen />
      </AppContext.Provider>
    )
  }

  if (!currentUserSession.authenticated) {
    return (
      <AppContext.Provider
        value={{
          usbDriveStatus: displayUsbStatus,
          usbDriveEject: usbDrive.eject,
          electionDefinition,
          machineConfig,
          storage,
          lockMachine,
        }}
      >
        <UnlockMachineScreen
          attemptToAuthenticateUser={attemptToAuthenticateUser}
        />
      </AppContext.Provider>
    )
  }

  if (electionDefinition) {
    if (electionJustLoaded) {
      return (
        <AppContext.Provider
          value={{
            usbDriveStatus: displayUsbStatus,
            usbDriveEject: usbDrive.eject,
            machineConfig,
            electionDefinition,
            storage,
            lockMachine,
          }}
        >
          <Screen>
            <Main>
              <MainChild center padded>
                <Prose>
                  <h1>Ballot Scanner Configured</h1>
                  <Text>
                    Ballot Scanner successfully configured. You may now eject
                    the USB drive.
                  </Text>
                </Prose>
                <Buttons>
                  <Button onPress={() => setElectionJustLoaded(false)}>
                    Close
                  </Button>
                  <USBControllerButton
                    small={false}
                    primary
                    usbDriveStatus={displayUsbStatus}
                    usbDriveEject={usbDrive.eject}
                  />
                </Buttons>
              </MainChild>
            </Main>
            <MainNav isTestMode={false}>
              <Button small onPress={lockMachine}>
                Lock Machine
              </Button>
            </MainNav>
          </Screen>
        </AppContext.Provider>
      )
    }
    if (adjudication.remaining > 0 && !isScanning) {
      return (
        <AppContext.Provider
          value={{
            usbDriveStatus: displayUsbStatus,
            usbDriveEject: usbDrive.eject,
            electionDefinition,
            machineConfig,
            storage,
            lockMachine,
          }}
        >
          <BallotEjectScreen
            continueScanning={continueScanning}
            isTestMode={isTestMode}
          />
        </AppContext.Provider>
      )
    }

    let exportButtonTitle
    if (adjudication.remaining > 0) {
      exportButtonTitle =
        'You cannot export results until all ballots have been adjudicated.'
    } else if (status.batches.length === 0) {
      exportButtonTitle =
        'You cannot export results until you have scanned at least 1 ballot.'
    }

    return (
      <AppContext.Provider
        value={{
          usbDriveStatus: displayUsbStatus,
          usbDriveEject: usbDrive.eject,
          electionDefinition,
          machineConfig,
          storage,
          lockMachine,
        }}
      >
        <Switch>
          <Route path="/advanced">
            <AdvancedOptionsScreen
              unconfigureServer={unconfigureServer}
              zeroData={zeroData}
              backup={backup}
              hasBatches={status.batches.length > 0}
              isTestMode={isTestMode}
              toggleTestMode={toggleTestMode}
              setMarkThresholdOverrides={setMarkThresholdOverrides}
              markThresholds={markThresholds}
              isTogglingTestMode={isTogglingTestMode}
              electionDefinition={electionDefinition}
            />
          </Route>
          <Route path="/">
            <Screen>
              <Main>
                <MainChild maxWidth={false}>
                  <DashboardScreen
                    isScanning={isScanning}
                    status={status}
                    deleteBatch={deleteBatch}
                  />
                </MainChild>
              </Main>
              <MainNav isTestMode={isTestMode}>
                <USBControllerButton
                  usbDriveStatus={displayUsbStatus}
                  usbDriveEject={usbDrive.eject}
                />
                <Button small onPress={lockMachine}>
                  Lock Machine
                </Button>
                <LinkButton small to="/advanced">
                  Advanced
                </LinkButton>
                <Button
                  small
                  onPress={() => setIsExportingCVRs(true)}
                  disabled={
                    adjudication.remaining > 0 || status.batches.length === 0
                  }
                  title={exportButtonTitle}
                >
                  Export
                </Button>
                <ScanButton onPress={scanBatch} disabled={isScanning} />
              </MainNav>
              <StatusFooter />
            </Screen>
            {isExportingCVRs && (
              <ExportResultsModal
                onClose={() => setIsExportingCVRs(false)}
                electionDefinition={electionDefinition}
                isTestMode={isTestMode}
                numberOfBallots={status.batches.reduce(
                  (prev, next) => prev + next.count,
                  0
                )}
              />
            )}
          </Route>
        </Switch>
      </AppContext.Provider>
    )
  }

  if (isConfigLoaded) {
    return (
      <AppContext.Provider
        value={{
          usbDriveStatus: displayUsbStatus,
          usbDriveEject: usbDrive.eject,
          machineConfig,
          electionDefinition,
          storage,
          lockMachine,
        }}
      >
        <LoadElectionScreen setElectionDefinition={updateElectionDefinition} />
      </AppContext.Provider>
    )
  }

  return (
    <Screen>
      <Main>
        <MainChild maxWidth={false}>
          <h1>Loading Configuration...</h1>
        </MainChild>
      </Main>
    </Screen>
  )
}

export default App
