import { Admin } from '@votingworks/api';
import {
  ContestId,
  ContestOptionId,
  ElectionDefinition,
  ExternalTallySourceType,
  FullElectionExternalTallies,
  FullElectionExternalTally,
  Id,
  Iso8601Timestamp,
  safeParseElectionDefinition,
} from '@votingworks/types';
import {
  assert,
  castVoteRecordVoteIsWriteIn,
  castVoteRecordVotes,
  groupBy,
  typedAs,
} from '@votingworks/utils';
import { v4 as uuid } from 'uuid';
import { CastVoteRecordFile, PrintedBallot } from '../../config/types';
import { CastVoteRecordFiles } from '../../utils/cast_vote_record_files';
import {
  AddCastVoteRecordFileResult,
  ElectionManagerStoreBackend,
} from './types';

interface MemoryWriteInRecord {
  readonly id: Id;
  readonly castVoteRecordId: Id;
  readonly contestId: ContestId;
  readonly optionId: ContestOptionId;
  readonly transcribedValue?: string;
  readonly adjudicatedValue?: string;
}

/**
 * An in-memory backend for ElectionManagerStore. Useful for tests or an
 * ephemeral session.
 */
export class ElectionManagerStoreMemoryBackend
  implements ElectionManagerStoreBackend
{
  private electionDefinition?: ElectionDefinition;
  private configuredAt?: Iso8601Timestamp;
  private printedBallots?: readonly PrintedBallot[];
  private fullElectionExternalTallies: Map<
    ExternalTallySourceType,
    FullElectionExternalTally
  >;
  private castVoteRecordFiles?: CastVoteRecordFiles;
  private isOfficialResults?: boolean;
  private writeIns: readonly MemoryWriteInRecord[];
  private writeInAdjudications: readonly Admin.WriteInAdjudicationRecord[];

  constructor({
    electionDefinition,
    configuredAt,
    printedBallots,
    fullElectionExternalTallies,
    castVoteRecordFiles,
    isOfficialResults,
    writeInAdjudications = [],
  }: {
    electionDefinition?: ElectionDefinition;
    configuredAt?: Iso8601Timestamp;
    printedBallots?: readonly PrintedBallot[];
    fullElectionExternalTallies?: FullElectionExternalTallies;
    castVoteRecordFiles?: CastVoteRecordFiles;
    isOfficialResults?: boolean;
    writeInAdjudications?: readonly Admin.WriteInAdjudicationRecord[];
  } = {}) {
    this.electionDefinition = electionDefinition;
    this.configuredAt =
      configuredAt ??
      (electionDefinition ? new Date().toISOString() : undefined);
    this.printedBallots = printedBallots;
    this.fullElectionExternalTallies = new Map([
      ...(fullElectionExternalTallies ?? []),
    ]);
    this.castVoteRecordFiles = castVoteRecordFiles;
    this.isOfficialResults = isOfficialResults;
    this.writeIns = [];
    this.writeInAdjudications = writeInAdjudications;
  }

  async reset(): Promise<void> {
    await Promise.resolve();
    this.electionDefinition = undefined;
    this.configuredAt = undefined;
    this.printedBallots = undefined;
    this.fullElectionExternalTallies = new Map();
    this.castVoteRecordFiles = undefined;
    this.isOfficialResults = undefined;
    this.writeIns = [];
    this.writeInAdjudications = [];
  }

  async loadElectionDefinitionAndConfiguredAt(): Promise<
    { electionDefinition: ElectionDefinition; configuredAt: string } | undefined
  > {
    await Promise.resolve();
    if (this.electionDefinition && this.configuredAt) {
      return {
        electionDefinition: this.electionDefinition,
        configuredAt: this.configuredAt,
      };
    }
  }

  async configure(newElectionData: string): Promise<ElectionDefinition> {
    await this.reset();

    const parseResult = safeParseElectionDefinition(newElectionData);

    if (parseResult.isErr()) {
      throw parseResult.err();
    }

    this.electionDefinition = parseResult.ok();
    this.configuredAt = new Date().toISOString();

    return this.electionDefinition;
  }

  loadCastVoteRecordFiles(): Promise<CastVoteRecordFiles | undefined> {
    return Promise.resolve(this.castVoteRecordFiles);
  }

  protected getWriteInsFromCastVoteRecords(
    castVoteRecordFile: CastVoteRecordFile
  ): Admin.WriteInRecord[] {
    const newWriteIns: Admin.WriteInRecord[] = [];
    for (const cvr of castVoteRecordFile.allCastVoteRecords) {
      for (const [contestId, votes] of castVoteRecordVotes(cvr)) {
        for (const vote of votes) {
          if (castVoteRecordVoteIsWriteIn(vote)) {
            assert(cvr._ballotId);

            newWriteIns.push({
              id: uuid(),
              contestId,
              castVoteRecordId: cvr._ballotId,
              optionId: vote,
              status: 'pending',
            });
          }
        }
      }
    }
    return newWriteIns;
  }

  async addCastVoteRecordFile(
    newCastVoteRecordFile: File
  ): Promise<AddCastVoteRecordFileResult> {
    if (!this.electionDefinition) {
      throw new Error('Election definition must be configured first');
    }

    this.castVoteRecordFiles = await (
      this.castVoteRecordFiles ?? CastVoteRecordFiles.empty
    ).add(newCastVoteRecordFile, this.electionDefinition.election);

    const wasExistingFile = this.castVoteRecordFiles.duplicateFiles.includes(
      newCastVoteRecordFile.name
    );
    const file = this.castVoteRecordFiles.fileList.find(
      (f) => f.name === newCastVoteRecordFile.name
    );
    const newlyAdded = file?.importedCvrCount ?? 0;
    const alreadyPresent = file?.duplicatedCvrCount ?? 0;

    if (!wasExistingFile && file) {
      const newWriteIns = this.getWriteInsFromCastVoteRecords(file);
      this.writeIns = [...(this.writeIns ?? []), ...newWriteIns];
    }

    return {
      wasExistingFile,
      newlyAdded,
      alreadyPresent,
    };
  }

  async clearCastVoteRecordFiles(): Promise<void> {
    await Promise.resolve();
    this.isOfficialResults = undefined;
    this.castVoteRecordFiles = undefined;
    this.writeIns = [];
    this.writeInAdjudications = [];
  }

  loadFullElectionExternalTallies(): Promise<
    FullElectionExternalTallies | undefined
  > {
    return Promise.resolve(new Map(this.fullElectionExternalTallies));
  }

  async updateFullElectionExternalTally(
    sourceType: ExternalTallySourceType,
    newFullElectionExternalTally: FullElectionExternalTally
  ): Promise<void> {
    await Promise.resolve();
    assert(newFullElectionExternalTally.source === sourceType);
    this.fullElectionExternalTallies.set(
      sourceType,
      newFullElectionExternalTally
    );
  }

  async removeFullElectionExternalTally(
    sourceType: ExternalTallySourceType
  ): Promise<void> {
    await Promise.resolve();
    this.fullElectionExternalTallies.delete(sourceType);
  }

  async clearFullElectionExternalTallies(): Promise<void> {
    await Promise.resolve();
    this.fullElectionExternalTallies = new Map();
  }

  loadIsOfficialResults(): Promise<boolean | undefined> {
    return Promise.resolve(this.isOfficialResults);
  }

  async markResultsOfficial(): Promise<void> {
    await Promise.resolve();
    this.isOfficialResults = true;
  }

  loadPrintedBallots(): Promise<PrintedBallot[] | undefined> {
    return Promise.resolve(this.printedBallots?.slice());
  }

  async addPrintedBallot(printedBallot: PrintedBallot): Promise<void> {
    await Promise.resolve();
    this.printedBallots = [...(this.printedBallots ?? []), printedBallot];
  }

  protected filterWriteIns(
    writeIns: readonly Admin.WriteInRecord[],
    options?: {
      contestId?: ContestId;
      status?: Admin.WriteInAdjudicationStatus;
    }
  ): Admin.WriteInRecord[] {
    return writeIns.filter((writeIn) => {
      if (options?.contestId && writeIn.contestId !== options.contestId) {
        return false;
      }
      if (options?.status && writeIn.status !== options.status) {
        return false;
      }
      return true;
    });
  }

  loadWriteIns(options?: {
    contestId?: ContestId;
    status?: Admin.WriteInAdjudicationStatus;
  }): Promise<Admin.WriteInRecord[]> {
    const { writeInAdjudications } = this;
    return Promise.resolve(
      this.filterWriteIns(
        this.writeIns.map((writeIn) => {
          if (!writeIn.transcribedValue) {
            return {
              id: writeIn.id,
              castVoteRecordId: writeIn.castVoteRecordId,
              contestId: writeIn.contestId,
              optionId: writeIn.optionId,
              status: 'pending',
            };
          }

          const adjudication = writeInAdjudications.find(
            (a) =>
              a.contestId === writeIn.contestId &&
              a.transcribedValue === writeIn.transcribedValue
          );

          if (!adjudication) {
            return typedAs<Admin.WriteInRecordTranscribed>({
              id: writeIn.id,
              castVoteRecordId: writeIn.castVoteRecordId,
              contestId: writeIn.contestId,
              optionId: writeIn.optionId,
              status: 'transcribed',
              transcribedValue: writeIn.transcribedValue,
            });
          }

          return typedAs<Admin.WriteInRecordAdjudicated>({
            id: writeIn.id,
            castVoteRecordId: writeIn.castVoteRecordId,
            contestId: writeIn.contestId,
            optionId: writeIn.optionId,
            status: 'adjudicated',
            transcribedValue: writeIn.transcribedValue,
            adjudicatedValue: adjudication.adjudicatedValue,
            adjudicatedOptionId: adjudication.adjudicatedOptionId,
          });
        }),
        options
      )
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  loadWriteInImage(cvrId: string): Promise<Admin.WriteInImageEntry[]> {
    return Promise.resolve([]);
  }

  async transcribeWriteIn(
    writeInId: Id,
    transcribedValue: string
  ): Promise<void> {
    await Promise.resolve();

    const { writeIns = [] } = this;

    const writeInIndex = writeIns.findIndex((w) => w.id === writeInId);
    if (writeInIndex < 0) {
      throw new Error(`Write-in not found: ${writeInId}`);
    }

    this.writeIns = [
      ...writeIns.slice(0, writeInIndex),
      {
        ...writeIns[writeInIndex],
        transcribedValue,
      },
      ...writeIns.slice(writeInIndex + 1),
    ];
  }

  async loadWriteInAdjudications(options?: {
    contestId?: ContestId;
  }): Promise<Admin.WriteInAdjudicationRecord[]> {
    await Promise.resolve();
    return (
      this.writeInAdjudications.filter(
        (writeInAdjudication) =>
          !options?.contestId ||
          writeInAdjudication.contestId === options.contestId
      ) ?? []
    );
  }

  async adjudicateWriteInTranscription(
    contestId: ContestId,
    transcribedValue: string,
    adjudicatedValue: string,
    adjudicatedOptionId?: ContestOptionId
  ): Promise<Id> {
    await Promise.resolve();

    const id = uuid();

    this.writeInAdjudications = [
      ...(this.writeInAdjudications ?? []),
      {
        id,
        contestId,
        transcribedValue,
        adjudicatedValue,
        adjudicatedOptionId,
      },
    ];

    return id;
  }

  async updateWriteInAdjudication(
    writeInAdjudicationId: Id,
    adjudicatedValue: string,
    adjudicatedOptionId?: ContestOptionId
  ): Promise<void> {
    await Promise.resolve();

    const { writeInAdjudications } = this;
    const writeInAdjudicationIndex = writeInAdjudications.findIndex(
      ({ id }) => id === writeInAdjudicationId
    );

    if (writeInAdjudicationIndex < 0) {
      throw new Error(
        `Write-in adjudication not found: ${writeInAdjudicationId}`
      );
    }

    this.writeInAdjudications = [
      ...writeInAdjudications.slice(0, writeInAdjudicationIndex),
      {
        ...writeInAdjudications[writeInAdjudicationIndex],
        adjudicatedValue,
        adjudicatedOptionId,
      },
      ...writeInAdjudications.slice(writeInAdjudicationIndex + 1),
    ];
  }

  async deleteWriteInAdjudication(writeInAdjudicationId: Id): Promise<void> {
    await Promise.resolve();

    const { writeInAdjudications } = this;
    const writeInAdjudicationIndex = writeInAdjudications.findIndex(
      ({ id }) => id === writeInAdjudicationId
    );

    if (writeInAdjudicationIndex < 0) {
      throw new Error(
        `Write-in adjudication not found: ${writeInAdjudicationId}`
      );
    }

    this.writeInAdjudications = [
      ...writeInAdjudications.slice(0, writeInAdjudicationIndex),
      ...writeInAdjudications.slice(writeInAdjudicationIndex + 1),
    ];
  }

  async getWriteInSummary({
    contestId,
  }: {
    contestId?: ContestId;
  } = {}): Promise<Admin.WriteInSummaryEntry[]> {
    const writeInAdjudications = await this.loadWriteInAdjudications({
      contestId,
    });

    return Array.from(
      groupBy(this.writeIns ?? [], (writeIn) => writeIn.contestId)
    ).flatMap(([writeInContestId, writeInsByContest]) =>
      !contestId || contestId === writeInContestId
        ? Array.from(
            groupBy(writeInsByContest, (writeIn) => writeIn.transcribedValue),
            ([
              transcribedValue,
              writeInsByContestAndTranscribedValue,
            ]): Admin.WriteInSummaryEntry => ({
              contestId: writeInContestId,
              transcribedValue,
              writeInCount: writeInsByContestAndTranscribedValue.size,
              writeInAdjudication: writeInAdjudications.find(
                (writeInAdjudication) =>
                  writeInAdjudication.transcribedValue === transcribedValue
              ),
            })
          )
        : []
    );
  }
}
