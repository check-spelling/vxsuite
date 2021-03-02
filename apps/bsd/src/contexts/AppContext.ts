import { Election } from '@votingworks/types'
import { createContext } from 'react'
import { MachineConfig } from '../config/types'

interface AppContextInterface {
  usbDriveStatus: string
  usbDriveEject: () => void
  machineConfig: MachineConfig
  election?: Election
  electionHash?: string
}

const appContext: AppContextInterface = {
  usbDriveStatus: '',
  usbDriveEject: () => undefined,
  machineConfig: { machineId: '0000' },
  election: undefined,
  electionHash: undefined,
}

const AppContext = createContext(appContext)

export default AppContext
