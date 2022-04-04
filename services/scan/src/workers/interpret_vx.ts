import { AdjudicationReason, PageInterpretation } from '@votingworks/types';
import { throwIllegalValue } from '@votingworks/utils';
import makeDebug from 'debug';
import { readFile } from 'fs-extra';
import { basename, extname, join } from 'path';
import { ScannerLocation, SCANNER_LOCATION } from '../globals';
import { Interpreter, InterpretFileResult } from '../interpreter';
import { Store } from '../store';
import { pdfToImages } from '../util/pdf_to_images';
import { saveImages } from '../util/save_images';
import * as qrcodeWorker from './qrcode';

const debug = makeDebug('scan:worker:interpret');

export const workerPath = __filename;

export type Input =
  | { action: 'configure'; dbPath: string }
  | {
      action: 'interpret';
      interpreter: 'vx';
      sheetId: string;
      imagePath: string;
      ballotImagesPath: string;
      detectQrcodeResult: qrcodeWorker.Output;
    };

export interface InterpretOutput {
  interpretation: PageInterpretation;
  originalFilename: string;
  normalizedFilename: string;
}

export type Output = InterpretOutput | void;

// eslint-disable-next-line import/no-mutable-exports
export let interpreter: Interpreter | undefined;

/**
 * Reads election configuration from the database.
 */
export async function configure(store: Store): Promise<void> {
  interpreter = undefined;

  debug('configuring from %s', store.getDbPath());
  const electionDefinition = store.getElectionDefinition();

  if (!electionDefinition) {
    debug('no election configured');
    return;
  }

  debug('election: %o', electionDefinition.election.title);
  const templates = store.getHmpbTemplates();

  debug('creating a new interpreter');
  interpreter = new Interpreter({
    electionDefinition,
    skipElectionHashCheck: store.getSkipElectionHashCheck(),
    testMode: store.getTestMode(),
    markThresholdOverrides: store.getMarkThresholdOverrides(),
    adjudicationReasons: (SCANNER_LOCATION === ScannerLocation.Central
      ? electionDefinition.election.centralScanAdjudicationReasons
      : electionDefinition.election.precinctScanAdjudicationReasons) ?? [
      AdjudicationReason.UninterpretableBallot,
      AdjudicationReason.MarginalMark,
    ],
  });

  debug('hand-marked paper ballot templates: %d', templates.length);
  for (const [pdf, layouts] of templates) {
    for await (const { page, pageNumber } of pdfToImages(pdf, { scale: 2 })) {
      const ballotPageLayout = layouts[pageNumber - 1];
      await interpreter.addHmpbTemplate({
        ballotPageLayout,
        imageData: page,
      });
    }
  }
}

export async function interpret(
  ballotImagePath: string,
  sheetId: string,
  ballotImagesPath: string,
  detectQrcodeResult: qrcodeWorker.Output
): Promise<InterpretOutput> {
  debug('interpret ballot image: %s', ballotImagePath);
  if (!interpreter) {
    throw new Error('cannot interpret ballot with no configured election');
  }

  const result: InterpretFileResult = !detectQrcodeResult.blank
    ? await interpreter.interpretFile({
        ballotImagePath,
        ballotImageFile: await readFile(ballotImagePath),
        detectQrcodeResult,
      })
    : { interpretation: { type: 'BlankPage' } };
  debug(
    'interpreted ballot image as %s: %s',
    result.interpretation.type,
    ballotImagePath
  );
  const ext = extname(ballotImagePath);
  const originalImagePath = join(
    ballotImagesPath,
    `${basename(ballotImagePath, ext)}-${sheetId}-original${ext}`
  );
  const normalizedImagePath = join(
    ballotImagesPath,
    `${basename(ballotImagePath, ext)}-${sheetId}-normalized${ext}`
  );
  const images = await saveImages(
    ballotImagePath,
    originalImagePath,
    normalizedImagePath,
    result.normalizedImage
  );
  return {
    interpretation: result.interpretation,
    originalFilename: images.original,
    normalizedFilename: images.normalized,
  };
}

export async function call(input: Input): Promise<Output> {
  switch (input.action) {
    case 'configure': {
      const store = Store.fileStore(input.dbPath);
      return await configure(store);
    }

    case 'interpret':
      return await interpret(
        input.imagePath,
        input.sheetId,
        input.ballotImagesPath,
        input.detectQrcodeResult
      );

    default:
      throwIllegalValue(input);
  }
}
