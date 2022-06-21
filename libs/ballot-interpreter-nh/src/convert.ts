import {
  AdjudicationReason,
  BallotPaperSize,
  BallotTargetMarkPosition,
  Candidate,
  CandidateContest,
  DistrictIdSchema,
  Election,
  GridPosition,
  GridPositionOption,
  GridPositionWriteIn,
  Party,
  PartyIdSchema,
  safeParse,
  safeParseElection,
  safeParseNumber,
  unsafeParse,
  YesNoContest,
} from '@votingworks/types';
import { assert, groupBy, throwIllegalValue, zipMin } from '@votingworks/utils';
import { sha256 } from 'js-sha256';
import { DateTime } from 'luxon';
import { ZodError } from 'zod';
import {
  decodeBackTimingMarkBits,
  decodeFrontTimingMarkBits,
  findTemplateOvals,
  getTemplateBallotCardGeometry,
  getTemplateBallotPaperSize,
  TemplateOval,
} from './accuvote';
import { Debugger } from './debug';
import { DefaultMarkThresholds } from './interpret';
import { findBallotTimingMarks } from './interpret/find_ballot_timing_marks';
import {
  decodeBottomRowTimingMarks,
  interpolateMissingTimingMarks,
} from './timing_marks';
import {
  BackMarksMetadata,
  BackMarksMetadataSchema,
  Bit,
  FrontMarksMetadata,
  FrontMarksMetadataSchema,
  PartialTimingMarks,
  Size,
} from './types';

export { interpret } from './interpret';

function makeId(text: string): string {
  const hash = sha256(text);
  return `${text.replace(/[^-_a-z\d+]+/gi, '-')}-${hash.substr(0, 8)}`;
}

const ElectionDefinitionVerticalTimingMarkDistance = 9;
const ElectionDefinitionHorizontalTimingMarkDistance = 108 / 7;
const ElectionDefinitionOriginX =
  236.126 - ElectionDefinitionHorizontalTimingMarkDistance * 12;
const ElectionDefinitionOriginY =
  245.768 - ElectionDefinitionVerticalTimingMarkDistance * 9;

function timingMarkCoordinatesFromOxOy(
  ox: number,
  oy: number
): { column: number; row: number } {
  return {
    column: Math.round(
      (ox - ElectionDefinitionOriginX) /
        ElectionDefinitionHorizontalTimingMarkDistance
    ),
    row: Math.round(
      (oy - ElectionDefinitionOriginY) /
        ElectionDefinitionVerticalTimingMarkDistance
    ),
  };
}

/**
 * Basic properties for an object located on a grid.
 */
export interface GridEntry {
  readonly side: 'front' | 'back';
  readonly column: number;
  readonly row: number;
}

function compareGridEntry(a: GridEntry, b: GridEntry): number {
  if (a.side !== b.side) {
    return a.side === 'front' ? -1 : 1;
  }
  return a.row - b.row;
}

/**
 * The kinds of errors that can occur during `pairColumnEntries`.
 */
export enum PairColumnEntriesIssueKind {
  ColumnCountMismatch = 'ColumnCountMismatch',
  ColumnEntryCountMismatch = 'ColumnEntryCountMismatch',
}

/**
 * Errors that can occur during `pairColumnEntries`.
 */
export type PairColumnEntriesIssue =
  | {
      kind: PairColumnEntriesIssueKind.ColumnCountMismatch;
      message: string;
      columnCounts: [number, number];
    }
  | {
      kind: PairColumnEntriesIssueKind.ColumnEntryCountMismatch;
      message: string;
      columnIndex: number;
      columnEntryCounts: [number, number];
    };

/**
 * Result of {@link pairColumnEntries}. The `issues` property is an array of
 * issues that occurred during the pairing process. If success is `false`,
 * then `entries` will only be partially populated.
 */
export type PairColumnEntriesResult<T extends GridEntry, U extends GridEntry> =
  | {
      readonly success: true;
      readonly pairs: ReadonlyArray<[T, U]>;
    }
  | {
      readonly success: false;
      readonly pairs: ReadonlyArray<[T, U]>;
      readonly issues: readonly PairColumnEntriesIssue[];
    };

/**
 * Pairs entries by column and row, ignoring the absolute values of the columns
 * and rows. There must be the same number of columns in both, and for each
 * column pair there must be the same number of rows in both.
 */
export function pairColumnEntries<T extends GridEntry, U extends GridEntry>(
  grid1: readonly T[],
  grid2: readonly U[]
): PairColumnEntriesResult<T, U> {
  const grid1ByColumn = groupBy(grid1, (e) => e.column);
  const grid2ByColumn = groupBy(grid2, (e) => e.column);
  const grid1Columns = Array.from(grid1ByColumn.entries())
    // sort by column
    .sort((a, b) => a[0] - b[0])
    // sort by side, row
    .map(([, entries]) => Array.from(entries).sort(compareGridEntry));
  const grid2Columns = Array.from(grid2ByColumn.entries())
    // sort by column
    .sort((a, b) => a[0] - b[0])
    // sort by side, row
    .map(([, entries]) => Array.from(entries).sort(compareGridEntry));
  const pairs: Array<[T, U]> = [];
  const issues: PairColumnEntriesIssue[] = [];

  if (grid1Columns.length !== grid2Columns.length) {
    issues.push({
      kind: PairColumnEntriesIssueKind.ColumnCountMismatch,
      message: `Grids have different number of columns: ${grid1Columns.length} vs ${grid2Columns.length}`,
      columnCounts: [grid1Columns.length, grid2Columns.length],
    });
  }

  let columnIndex = 0;
  for (const [column1, column2] of zipMin(grid1Columns, grid2Columns)) {
    if (column1.length !== column2.length) {
      issues.push({
        kind: PairColumnEntriesIssueKind.ColumnEntryCountMismatch,
        message: `Columns at index ${columnIndex} disagree on entry count: grid #1 has ${column1.length} entries, but grid #2 has ${column2.length} entries`,
        columnIndex,
        columnEntryCounts: [column1.length, column2.length],
      });
    }
    for (const [entry1, entry2] of zipMin(column1, column2)) {
      pairs.push([entry1, entry2]);
    }
    columnIndex += 1;
  }

  return issues.length
    ? { success: false, pairs, issues }
    : { success: true, pairs };
}

/**
 * Contains the metadata and ballot images for a ballot card.
 */
export interface NewHampshireBallotCardDefinition {
  /**
   * XML element containing the ballot card definition, including election info
   * and contests with candidates.
   */
  readonly definition: Element;

  /**
   * An image of the ballot card's front as rendered from a PDF.
   */
  readonly front: ImageData;

  /**
   * An image of the ballot card's back as rendered from a PDF.
   */
  readonly back: ImageData;
}

/**
 * Contains candidate elements and their LCM column/row coordinates.
 */
export interface CandidateGridElement {
  readonly element: Element;
  readonly column: number;
  readonly row: number;
}

/**
 * Finds all candidates and arranges them in a LCM grid.
 */
export function readGridFromElectionDefinition(
  root: Element
): CandidateGridElement[] {
  return Array.from(root.getElementsByTagName('CandidateName')).map(
    (candidateElement) => {
      const ox = safeParseNumber(
        candidateElement.getElementsByTagName('OX')[0]?.textContent
      ).unsafeUnwrap();
      const oy = safeParseNumber(
        candidateElement.getElementsByTagName('OY')[0]?.textContent
      ).unsafeUnwrap();
      const { column, row } = timingMarkCoordinatesFromOxOy(ox, oy);
      return { element: candidateElement, column, row };
    }
  );
}

/**
 * Kinds of errors that can occur when converting a ballot card definition.
 */
export enum ConvertIssueKind {
  ElectionValidationFailed = 'ElectionValidationFailed',
  InvalidBallotSize = 'InvalidBallotSize',
  InvalidDistrictId = 'InvalidDistrictId',
  InvalidElectionDate = 'InvalidElectionDate',
  InvalidTemplateSize = 'InvalidTemplateSize',
  InvalidTimingMarkMetadata = 'InvalidTimingMarkMetadata',
  MismatchedBallotImageSize = 'MismatchedBallotImageSize',
  MismatchedOvalGrids = 'MismatchedOvalGrids',
  MissingDefinitionProperty = 'MissingDefinitionProperty',
  MissingTimingMarkMetadata = 'MissingTimingMarkMetadata',
  TimingMarkDetectionFailed = 'TimingMarkDetectionFailed',
}

/**
 * Issues that can occur when converting a ballot card definition.
 */
export type ConvertIssue =
  | {
      kind: ConvertIssueKind.ElectionValidationFailed;
      message: string;
      validationError: ZodError;
    }
  | {
      kind: ConvertIssueKind.InvalidBallotSize;
      message: string;
      invalidBallotSize: string;
    }
  | {
      kind: ConvertIssueKind.InvalidTemplateSize;
      message: string;
      paperSize?: BallotPaperSize;
      frontTemplateSize: Size;
      backTemplateSize: Size;
    }
  | {
      kind: ConvertIssueKind.InvalidDistrictId;
      message: string;
      invalidDistrictId: string;
    }
  | {
      kind: ConvertIssueKind.InvalidElectionDate;
      message: string;
      invalidDate: string;
      invalidReason: string;
    }
  | {
      kind: ConvertIssueKind.InvalidTimingMarkMetadata;
      message: string;
      side: 'front' | 'back';
      timingMarks: PartialTimingMarks;
      timingMarkBits: readonly Bit[];
      validationError: ZodError;
    }
  | {
      kind: ConvertIssueKind.MismatchedOvalGrids;
      message: string;
      pairColumnEntriesIssue: PairColumnEntriesIssue;
    }
  | {
      kind: ConvertIssueKind.MissingDefinitionProperty;
      message: string;
      property: string;
    }
  | {
      kind: ConvertIssueKind.MissingTimingMarkMetadata;
      message: string;
      side: 'front' | 'back';
      timingMarks: PartialTimingMarks;
    }
  | {
      kind: ConvertIssueKind.TimingMarkDetectionFailed;
      message: string;
      side: 'front' | 'back';
    };

/**
 * Contains the result of converting a ballot card definition.
 */
export type ConvertResult =
  | {
      readonly success: true;
      readonly election: Election;
      readonly issues: readonly ConvertIssue[];
    }
  | {
      readonly success: false;
      readonly election?: Election;
      readonly issues: readonly ConvertIssue[];
    };

/**
 * Creates an election definition only from the ballot metadata, ignoring the
 * ballot images.
 */
export function convertElectionDefinitionHeader(
  definition: NewHampshireBallotCardDefinition['definition']
): ConvertResult {
  const root = definition;
  const accuvoteHeaderInfo = root.getElementsByTagName('AccuvoteHeaderInfo')[0];
  const electionId =
    accuvoteHeaderInfo?.getElementsByTagName('ElectionID')[0]?.textContent;
  if (typeof electionId !== 'string') {
    return {
      success: false,
      issues: [
        {
          kind: ConvertIssueKind.MissingDefinitionProperty,
          message: 'ElectionID is missing',
          property: 'AVSInterface > AccuvoteHeaderInfo > ElectionID',
        },
      ],
    };
  }

  const title =
    accuvoteHeaderInfo?.getElementsByTagName('ElectionName')[0]?.textContent;
  if (typeof title !== 'string') {
    return {
      success: false,
      issues: [
        {
          kind: ConvertIssueKind.MissingDefinitionProperty,
          message: 'ElectionName is missing',
          property: 'AVSInterface > AccuvoteHeaderInfo > ElectionName',
        },
      ],
    };
  }

  const townName =
    accuvoteHeaderInfo?.getElementsByTagName('TownName')[0]?.textContent;
  if (typeof townName !== 'string') {
    return {
      success: false,
      issues: [
        {
          kind: ConvertIssueKind.MissingDefinitionProperty,
          message: 'TownName is missing',
          property: 'AVSInterface > AccuvoteHeaderInfo > TownName',
        },
      ],
    };
  }

  const townId =
    accuvoteHeaderInfo?.getElementsByTagName('TownID')[0]?.textContent;
  if (typeof townId !== 'string') {
    return {
      success: false,
      issues: [
        {
          kind: ConvertIssueKind.MissingDefinitionProperty,
          message: 'TownID is missing',
          property: 'AVSInterface > AccuvoteHeaderInfo > TownID',
        },
      ],
    };
  }

  const rawDate =
    accuvoteHeaderInfo?.getElementsByTagName('ElectionDate')[0]?.textContent;
  if (typeof rawDate !== 'string') {
    return {
      success: false,
      issues: [
        {
          kind: ConvertIssueKind.MissingDefinitionProperty,
          message: 'ElectionDate is missing',
          property: 'AVSInterface > AccuvoteHeaderInfo > ElectionDate',
        },
      ],
    };
  }

  const parsedDate = DateTime.fromFormat(rawDate.trim(), 'M/d/yyyy HH:mm:ss', {
    locale: 'en-US',
    zone: 'America/New_York',
  });
  if (parsedDate.invalidReason) {
    return {
      success: false,
      issues: [
        {
          kind: ConvertIssueKind.InvalidElectionDate,
          message: `invalid date: ${parsedDate.invalidReason}`,
          invalidDate: rawDate,
          invalidReason: parsedDate.invalidReason,
        },
      ],
    };
  }

  const rawPrecinctId = root.getElementsByTagName('PrecinctID')[0]?.textContent;
  if (typeof rawPrecinctId !== 'string') {
    return {
      success: false,
      issues: [
        {
          kind: ConvertIssueKind.MissingDefinitionProperty,
          message: 'PrecinctID is missing',
          property: 'AVSInterface > AccuvoteHeaderInfo > PrecinctID',
        },
      ],
    };
  }
  const cleanedPrecinctId = rawPrecinctId.replace(/[^-_\w]/g, '');
  const precinctId = `town-id-${townId}-precinct-id-${cleanedPrecinctId}`;

  const rawDistrictId = `town-id-${townId}-precinct-id-${cleanedPrecinctId}`;
  const districtIdResult = safeParse(DistrictIdSchema, rawDistrictId);
  if (districtIdResult.isErr()) {
    return {
      success: false,
      issues: [
        {
          kind: ConvertIssueKind.InvalidDistrictId,
          message: `Invalid district ID "${rawDistrictId}": ${
            districtIdResult.err().message
          }`,
          invalidDistrictId: rawDistrictId,
        },
      ],
    };
  }
  const districtId = districtIdResult.ok();

  const ballotSize = root.getElementsByTagName('BallotSize')[0]?.textContent;
  if (typeof ballotSize !== 'string') {
    return {
      success: false,
      issues: [
        {
          kind: ConvertIssueKind.MissingDefinitionProperty,
          message: 'BallotSize is missing',
          property: 'AVSInterface > AccuvoteHeaderInfo > BallotSize',
        },
      ],
    };
  }
  let paperSize: BallotPaperSize;
  switch (ballotSize) {
    case '8.5X11':
      paperSize = BallotPaperSize.Letter;
      break;

    case '8.5X14':
      paperSize = BallotPaperSize.Legal;
      break;

    default:
      return {
        success: false,
        issues: [
          {
            kind: ConvertIssueKind.InvalidBallotSize,
            message: `invalid ballot size: ${ballotSize}`,
            invalidBallotSize: ballotSize,
          },
        ],
      };
  }
  const geometry = getTemplateBallotCardGeometry(paperSize);

  const parties = new Map<string, Party>();
  const contests: Array<CandidateContest | YesNoContest> = [];
  const optionMetadataByCandidateElement = new Map<
    Element,
    | Omit<GridPositionOption, 'row' | 'column' | 'side'>
    | Omit<GridPositionWriteIn, 'row' | 'column' | 'side'>
  >();

  for (const contestElement of Array.from(
    root.getElementsByTagName('Candidates')
  )) {
    const officeNameElement =
      contestElement.getElementsByTagName('OfficeName')[0];
    const officeName =
      officeNameElement?.getElementsByTagName('Name')[0]?.textContent;
    if (typeof officeName !== 'string') {
      return {
        success: false,
        issues: [
          {
            kind: ConvertIssueKind.MissingDefinitionProperty,
            message: 'OfficeName is missing',
            property: 'AVSInterface > Candidates > OfficeName > Name',
          },
        ],
      };
    }
    const contestId = makeId(officeName);

    const winnerNote =
      officeNameElement?.getElementsByTagName('WinnerNote')[0]?.textContent;
    const seats =
      safeParseNumber(
        winnerNote?.match(/Vote for not more than (\d+)/)?.[1]
      ).ok() ?? 1;

    let writeInIndex = 0;
    const candidates: Candidate[] = [];
    for (const [i, candidateElement] of Array.from(
      contestElement.getElementsByTagName('CandidateName')
    ).entries()) {
      const candidateName =
        candidateElement.getElementsByTagName('Name')[0]?.textContent;
      if (typeof candidateName !== 'string') {
        return {
          success: false,
          issues: [
            {
              kind: ConvertIssueKind.MissingDefinitionProperty,
              message: `Name is missing in candidate ${i + 1} of ${officeName}`,
              property: 'AVSInterface > Candidates > CandidateName > Name',
            },
          ],
        };
      }

      let party: Party | undefined;
      const partyName =
        candidateElement?.getElementsByTagName('Party')[0]?.textContent;
      if (partyName) {
        party = parties.get(partyName);
        if (!party) {
          const partyId = makeId(partyName);
          party = {
            id: unsafeParse(PartyIdSchema, partyId),
            name: partyName,
            fullName: partyName,
            abbrev: partyName,
          };
          parties.set(partyName, party);
        }
      }

      const isWriteIn =
        candidateElement?.getElementsByTagName('WriteIn')[0]?.textContent ===
        'True';

      if (!isWriteIn) {
        const candidateId = makeId(candidateName);
        const existingCandidateIndex = candidates.findIndex(
          (candidate) => candidate.id === candidateId
        );

        if (existingCandidateIndex >= 0) {
          const existingPartyIds = candidates[existingCandidateIndex]?.partyIds;
          if (!party || !existingPartyIds) {
            return {
              success: false,
              issues: [
                {
                  kind: ConvertIssueKind.MissingDefinitionProperty,
                  message: `Party is missing in candidate "${candidateName}" of office "${officeName}", required for multi-party endorsement`,
                  property: 'AVSInterface > Candidates > CandidateName > Party',
                },
              ],
            };
          }

          candidates[existingCandidateIndex] = {
            id: candidateId,
            name: candidateName,
            partyIds: [...existingPartyIds, party.id],
          };
        } else {
          const candidate: Candidate = {
            id: candidateId,
            name: candidateName,
            ...(party ? { partyIds: [party.id] } : {}),
          };
          candidates.push(candidate);
        }

        optionMetadataByCandidateElement.set(candidateElement, {
          type: 'option',
          contestId,
          optionId: candidateId,
        });
      } else {
        optionMetadataByCandidateElement.set(candidateElement, {
          type: 'write-in',
          contestId,
          writeInIndex,
        });
        writeInIndex += 1;
      }
    }

    contests.push({
      type: 'candidate',
      id: contestId,
      title: officeName,
      section: officeName,
      districtId,
      seats,
      allowWriteIns: writeInIndex > 0,
      candidates,
      // TODO: party ID?
    });
  }

  const definitionGrid = readGridFromElectionDefinition(root);

  const election: Election = {
    title,
    date: parsedDate.toISO(),
    county: {
      id: townId,
      name: townName,
    },
    state: 'NH',
    parties: Array.from(parties.values()),
    precincts: [
      {
        id: precinctId,
        name: townName,
      },
    ],
    districts: [
      {
        id: districtId,
        name: townName,
      },
    ],
    ballotStyles: [
      {
        id: 'default',
        districts: [districtId],
        precincts: [precinctId],
      },
    ],
    contests,
    ballotLayout: {
      paperSize,
      targetMarkPosition: BallotTargetMarkPosition.Right,
    },
    markThresholds: DefaultMarkThresholds,
    gridLayouts: [
      {
        precinctId,
        ballotStyleId: 'default',
        columns: geometry.gridSize.width,
        rows: geometry.gridSize.height,
        gridPositions: definitionGrid.map(({ element, column, row }) => {
          const metadata = optionMetadataByCandidateElement.get(element);
          assert(metadata, `metadata missing for column=${column} row=${row}`);
          return metadata.type === 'option'
            ? {
                type: 'option',
                side: 'front',
                column,
                row,
                contestId: metadata.contestId,
                optionId: metadata.optionId,
              }
            : {
                type: 'write-in',
                side: 'front',
                column,
                row,
                contestId: metadata.contestId,
                writeInIndex: metadata.writeInIndex,
              };
        }),
      },
    ],
    centralScanAdjudicationReasons: [
      AdjudicationReason.UninterpretableBallot,
      AdjudicationReason.Overvote,
      AdjudicationReason.MarkedWriteIn,
      AdjudicationReason.BlankBallot,
    ],
    precinctScanAdjudicationReasons: [
      AdjudicationReason.UninterpretableBallot,
      AdjudicationReason.Overvote,
      AdjudicationReason.BlankBallot,
    ],
    sealUrl: '/seals/Seal_of_New_Hampshire.svg',
  };

  const parseElectionResult = safeParseElection(election);

  if (parseElectionResult.isErr()) {
    return {
      success: false,
      issues: [
        {
          kind: ConvertIssueKind.ElectionValidationFailed,
          message: parseElectionResult.err().message,
          validationError: parseElectionResult.err(),
        },
      ],
    };
  }

  return {
    success: true,
    election: parseElectionResult.ok(),
    issues: [],
  };
}

/**
 * Convert New Hampshire XML files to a single {@link Election} object.
 */
export function convertElectionDefinition(
  cardDefinition: NewHampshireBallotCardDefinition,
  { ovalTemplate, debug }: { ovalTemplate: ImageData; debug?: Debugger }
): ConvertResult {
  const convertHeaderResult = convertElectionDefinitionHeader(
    cardDefinition.definition
  );

  if (!convertHeaderResult.success) {
    return convertHeaderResult;
  }

  const { election, issues: headerIssues } = convertHeaderResult;
  let success = true;
  const issues = [...headerIssues];

  let paperSize = election.ballotLayout?.paperSize;

  const frontExpectedPaperSize = getTemplateBallotPaperSize({
    width: cardDefinition.front.width,
    height: cardDefinition.front.height,
  });
  const backExpectedPaperSize = getTemplateBallotPaperSize({
    width: cardDefinition.back.width,
    height: cardDefinition.back.height,
  });

  if (
    !frontExpectedPaperSize ||
    !backExpectedPaperSize ||
    frontExpectedPaperSize !== backExpectedPaperSize ||
    frontExpectedPaperSize !== paperSize
  ) {
    success = frontExpectedPaperSize === backExpectedPaperSize;
    issues.push({
      kind: ConvertIssueKind.InvalidTemplateSize,
      message: `Template images do not match expected sizes.`,
      paperSize,
      frontTemplateSize: {
        width: cardDefinition.front.width,
        height: cardDefinition.front.height,
      },
      backTemplateSize: {
        width: cardDefinition.back.width,
        height: cardDefinition.back.height,
      },
    });
    paperSize = frontExpectedPaperSize;
  }

  assert(paperSize, 'paperSize should always be set');
  const expectedCardGeometry = getTemplateBallotCardGeometry(paperSize);

  debug?.layer('front page');
  const frontTimingMarks = findBallotTimingMarks(cardDefinition.front, {
    geometry: expectedCardGeometry,
    debug,
  });
  debug?.layerEnd('front page');

  if (!frontTimingMarks) {
    success = false;
    issues.push({
      kind: ConvertIssueKind.TimingMarkDetectionFailed,
      message: 'no timing marks found on front',
      side: 'front',
    });
  }

  debug?.layer('back page');
  const backTimingMarks = findBallotTimingMarks(cardDefinition.back, {
    geometry: expectedCardGeometry,
    debug,
  });
  debug?.layerEnd('back page');

  if (!backTimingMarks) {
    success = false;
    issues.push({
      kind: ConvertIssueKind.TimingMarkDetectionFailed,
      message: 'no timing marks found on back',
      side: 'back',
    });
  }

  let frontBits: Bit[] | undefined;
  if (frontTimingMarks) {
    frontBits = decodeBottomRowTimingMarks(frontTimingMarks)?.reverse();

    if (!frontBits) {
      success = false;
      issues.push({
        kind: ConvertIssueKind.MissingTimingMarkMetadata,
        message: 'could not read bottom timing marks on front as bits',
        side: 'front',
        timingMarks: frontTimingMarks,
      });
    }
  }

  let backBits: Bit[] | undefined;
  if (backTimingMarks) {
    backBits = decodeBottomRowTimingMarks(backTimingMarks)?.reverse();

    if (!backBits) {
      success = false;
      issues.push({
        kind: ConvertIssueKind.MissingTimingMarkMetadata,
        message: 'could not read bottom timing marks on back as bits',
        side: 'back',
        timingMarks: backTimingMarks,
      });
    }
  }

  let frontMetadata: FrontMarksMetadata | undefined;
  if (frontTimingMarks && frontBits) {
    const frontMetadataResult = safeParse(
      FrontMarksMetadataSchema,
      decodeFrontTimingMarkBits(frontBits)
    );

    if (frontMetadataResult.isErr()) {
      success = false;
      issues.push({
        kind: ConvertIssueKind.InvalidTimingMarkMetadata,
        message: `could not parse front timing mark metadata: ${
          frontMetadataResult.err().message
        }`,
        side: 'front',
        timingMarks: frontTimingMarks,
        timingMarkBits: frontBits,
        validationError: frontMetadataResult.err(),
      });
    } else {
      frontMetadata = frontMetadataResult.ok();
    }
  }

  let backMetadata: BackMarksMetadata | undefined;
  if (backTimingMarks && backBits) {
    const backMetadataResult = safeParse(
      BackMarksMetadataSchema,
      decodeBackTimingMarkBits(backBits)
    );

    if (backMetadataResult.isErr()) {
      success = false;
      issues.push({
        kind: ConvertIssueKind.InvalidTimingMarkMetadata,
        message: `could not parse back timing mark metadata: ${
          backMetadataResult.err().message
        }`,
        side: 'back',
        timingMarks: backTimingMarks,
        timingMarkBits: backBits,
        validationError: backMetadataResult.err(),
      });
    } else {
      backMetadata = backMetadataResult.ok();
    }
  }

  if (
    !frontMetadata ||
    !backMetadata ||
    !frontTimingMarks ||
    !backTimingMarks
  ) {
    return {
      success,
      issues,
      election,
    };
  }

  const ballotStyleId = `card-number-${frontMetadata.cardNumber}`;

  const frontCompleteTimingMarks =
    interpolateMissingTimingMarks(frontTimingMarks);
  const backCompleteTimingMarks =
    interpolateMissingTimingMarks(backTimingMarks);

  const frontTemplateOvals = findTemplateOvals(
    cardDefinition.front,
    ovalTemplate,
    frontCompleteTimingMarks,
    { usableArea: expectedCardGeometry.frontUsableArea, debug }
  );
  const backTemplateOvals = findTemplateOvals(
    cardDefinition.back,
    ovalTemplate,
    backCompleteTimingMarks,
    { usableArea: expectedCardGeometry.backUsableArea, debug }
  );

  const gridLayout = election.gridLayouts?.[0];
  assert(gridLayout, 'grid layout missing');

  const ballotStyle = election.ballotStyles[0];
  assert(ballotStyle, 'ballot style missing');

  type TemplateOvalGridEntry = TemplateOval & { side: 'front' | 'back' };
  const ovalGrid = [
    ...frontTemplateOvals.map<TemplateOvalGridEntry>((oval) => ({
      ...oval,
      side: 'front',
    })),
    ...backTemplateOvals.map<TemplateOvalGridEntry>((oval) => ({
      ...oval,
      side: 'back',
    })),
  ];

  const pairColumnEntriesResult = pairColumnEntries(
    gridLayout.gridPositions.map<GridPosition>((gridPosition) => ({
      ...gridPosition,
    })),
    ovalGrid
  );

  if (!pairColumnEntriesResult.success) {
    success = false;

    for (const issue of pairColumnEntriesResult.issues) {
      switch (issue.kind) {
        case PairColumnEntriesIssueKind.ColumnCountMismatch:
          issues.push({
            kind: ConvertIssueKind.MismatchedOvalGrids,
            message: `XML definition and ballot images have different number of columns containing ovals: ${issue.columnCounts[0]} vs ${issue.columnCounts[1]}`,
            pairColumnEntriesIssue: issue,
          });
          break;

        case PairColumnEntriesIssueKind.ColumnEntryCountMismatch:
          issues.push({
            kind: ConvertIssueKind.MismatchedOvalGrids,
            message: `XML definition and ballot images have different number of entries in column ${issue.columnIndex}: ${issue.columnEntryCounts[0]} vs ${issue.columnEntryCounts[1]}`,
            pairColumnEntriesIssue: issue,
          });
          break;

        default:
          throwIllegalValue(issue, 'kind');
      }
    }
  }

  const mergedGrids = pairColumnEntriesResult.pairs;
  const result: Election = {
    ...election,
    ballotLayout: {
      ...(election.ballotLayout ?? {}),
      paperSize,
    },
    ballotStyles: [
      {
        ...ballotStyle,
        id: ballotStyleId,
      },
    ],
    gridLayouts: [
      {
        ...gridLayout,
        ballotStyleId,
        gridPositions: mergedGrids.map(([definition, oval]) => ({
          ...definition,
          side: oval.side,
          column: oval.column,
          row: oval.row,
        })),
      },
    ],
  };

  return { success, issues, election: result };
}
