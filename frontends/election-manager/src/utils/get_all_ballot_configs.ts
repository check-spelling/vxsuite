import { BallotLocales, Election } from '@votingworks/types';
import { BallotConfig } from '@votingworks/utils';
import { DEFAULT_LOCALE } from '../config/globals';
import { BallotMode } from '../config/types';
import { getBallotPath, getBallotStylesDataByStyle } from './election';

export function getAllBallotConfigs(
  election: Election,
  electionHash: string,
  localeCodes: readonly string[]
): BallotConfig[] {
  const ballotStyles = getBallotStylesDataByStyle(election);
  const allLocaleConfigs = localeCodes.map<BallotLocales>((localeCode) => ({
    primary: DEFAULT_LOCALE,
    secondary: localeCode !== DEFAULT_LOCALE ? localeCode : undefined,
  }));

  return ballotStyles.flatMap((ballotStyle) =>
    allLocaleConfigs.flatMap((locales) =>
      [true, false].flatMap<BallotConfig>((isAbsentee) =>
        [true, false].flatMap<BallotConfig>((isLiveMode) => ({
          ballotStyleId: ballotStyle.ballotStyleId,
          precinctId: ballotStyle.precinctId,
          contestIds: ballotStyle.contestIds,
          isLiveMode,
          isAbsentee,
          locales,
          filename: getBallotPath({
            ...ballotStyle,
            election,
            electionHash,
            locales,
            ballotMode: isLiveMode ? BallotMode.Official : BallotMode.Test,
            isAbsentee,
          }),
          layoutFilename: getBallotPath({
            ...ballotStyle,
            election,
            electionHash,
            locales,
            ballotMode: isLiveMode ? BallotMode.Official : BallotMode.Test,
            isAbsentee,
            variant: 'layout',
            extension: '.json',
          }),
        }))
      )
    )
  );
}
