import { safeParse } from '@votingworks/types';
import { join } from 'path';
import { z } from 'zod';

const MachineTypeSchema = z.union([
  z.literal('bsd'),
  z.literal('precinct-scanner'),
]);

const NodeEnvSchema = z.union([
  z.literal('development'),
  z.literal('test'),
  z.literal('production'),
]);

/**
 * Use a mock scanner exposed over HTTP?
 */
export const MOCK_SCANNER_HTTP = process.env.MOCK_SCANNER_HTTP === '1';

/**
 * Default port for the API to control the mock scanner.
 */
export const MOCK_SCANNER_PORT = 9999;

/**
 * A list or pointer to a list of files to use for a mock scanner.
 */
export const { MOCK_SCANNER_FILES } = process.env;

/**
 * Default port for the module-scan API.
 */
export const MODULE_SCAN_PORT = Number(process.env.PORT || 3002);

/**
 * Which machine type is this?
 */
export const VX_MACHINE_TYPE = safeParse(
  MachineTypeSchema,
  process.env.VX_MACHINE_TYPE ?? 'bsd'
).unsafeUnwrap();

export enum ScannerLocation {
  Central = 'Central',
  Precinct = 'Precinct',
}

export const SCANNER_LOCATION =
  VX_MACHINE_TYPE === 'bsd'
    ? ScannerLocation.Central
    : ScannerLocation.Precinct;

/**
 * What's the unique ID for this machine?
 */
export const VX_MACHINE_ID = process.env.VX_MACHINE_ID ?? '000';

/**
 * Which node environment is this?
 */
export const NODE_ENV = safeParse(
  NodeEnvSchema,
  process.env.NODE_ENV ?? 'development'
).unsafeUnwrap();

/**
 * Where should the database and image files etc go?
 */
export const MODULE_SCAN_WORKSPACE =
  process.env.MODULE_SCAN_WORKSPACE ??
  (NODE_ENV === 'development'
    ? join(__dirname, '../dev-workspace')
    : undefined);

/**
 * Should the precinct scanner hold onto the paper on reject?
 */
export const MODULE_SCAN_ALWAYS_HOLD_ON_REJECT =
  process.env.MODULE_SCAN_ALWAYS_HOLD_ON_REJECT !== '0';
