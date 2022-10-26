import { assert, BALLOT_PDFS_FOLDER } from '@votingworks/utils';
import React, {
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useParams, useHistory } from 'react-router-dom';
import styled from 'styled-components';
import {
  BallotLocale,
  getBallotStyle,
  getContests,
  getPrecinctById,
  getElectionLocales,
  BallotStyle,
} from '@votingworks/types';
import pluralize from 'pluralize';

import { LogEventId } from '@votingworks/logging';
import {
  Button,
  SegmentedButton,
  isElectionManagerAuth,
  isSystemAdministratorAuth,
  Monospace,
  Prose,
  useStoredState,
} from '@votingworks/ui';
import { Admin } from '@votingworks/api';
import { z } from 'zod';
import { BallotScreenProps, PrintableBallotType } from '../config/types';
import { AppContext } from '../contexts/app_context';

import { PrintButton } from '../components/print_button';
import { HandMarkedPaperBallot } from '../components/hand_marked_paper_ballot';
import {
  getBallotPath,
  getHumanBallotLanguageFormat,
  isSuperBallotStyle,
} from '../utils/election';
import { NavigationScreen } from '../components/navigation_screen';
import { DEFAULT_LOCALE } from '../config/globals';
import { routerPaths } from '../router_paths';
import { LinkButton } from '../components/link_button';
import { getBallotLayoutPageSizeReadableString } from '../utils/get_ballot_layout_page_size';
import { generateFileContentToSaveAsPdf } from '../utils/save_as_pdf';
import { SaveFileToUsb, FileType } from '../components/save_file_to_usb';
import { BallotCopiesInput } from '../components/ballot_copies_input';
import { BallotModeToggle } from '../components/ballot_mode_toggle';
import { BallotTypeToggle } from '../components/ballot_type_toggle';
import { PrintBallotButtonText } from '../components/print_ballot_button_text';
import { useAddPrintedBallotMutation } from '../hooks/use_add_printed_ballot_mutation';
import { ServicesContext } from '../contexts/services_context';

const BallotPreviewHeader = styled.div`
  margin-top: 1rem;
  overflow: auto;
  h4 {
    float: left;
    margin: 0;
    width: 8.5in;
    &:first-child {
      margin-right: 1rem;
    }
  }
`;

const BallotPreview = styled.div`
  border-width: 1px 0;
  overflow: auto;
  /* stylelint-disable-next-line selector-class-pattern */
  & .pagedjs_page {
    float: left;
    margin: 1rem 1rem 0 0;
    background: #ffffff;
    &:nth-child(odd) {
      clear: left;
    }
  }
`;

export function BallotScreen(): JSX.Element {
  const history = useHistory();
  const ballotPreviewRef = useRef<HTMLDivElement>(null);
  const {
    precinctId,
    ballotStyleId,
    localeCode: currentLocaleCode,
  } = useParams<BallotScreenProps>();
  const { electionDefinition, printBallotRef, logger, auth } =
    useContext(AppContext);
  const { storage } = useContext(ServicesContext);
  const addPrintedBallotMutation = useAddPrintedBallotMutation();
  assert(isElectionManagerAuth(auth) || isSystemAdministratorAuth(auth));
  const userRole = auth.user.role;
  assert(electionDefinition);
  const { election, electionHash } = electionDefinition;
  const availableLocaleCodes = getElectionLocales(election, DEFAULT_LOCALE);
  const locales = useMemo<BallotLocale>(
    () => ({
      primary: DEFAULT_LOCALE,
      secondary: currentLocaleCode,
    }),
    [currentLocaleCode]
  );

  const precinctName = isSuperBallotStyle(ballotStyleId)
    ? 'All'
    : getPrecinctById({ election, precinctId })?.name;
  let ballotStyle: BallotStyle | undefined;
  if (isSuperBallotStyle(ballotStyleId)) {
    ballotStyle = undefined;
  } else {
    ballotStyle = getBallotStyle({ ballotStyleId, election });
    assert(ballotStyle);
  }
  const ballotContests = ballotStyle
    ? getContests({ ballotStyle, election })
    : election.contests;

  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [ballotPages, setBallotPages] = useState(0);
  const storageKeyPrefix = auth.user.role;
  const [ballotMode, setBallotMode] = useStoredState(
    storage,
    `${storageKeyPrefix}:BallotModeToggle:ballotMode`,
    Admin.BallotModeSchema,
    isSystemAdministratorAuth(auth)
      ? Admin.BallotMode.Sample
      : Admin.BallotMode.Official
  );
  const [isAbsentee, setIsAbsentee] = useStoredState(
    storage,
    `${storageKeyPrefix}:BallotTypeToggle:isAbsentee`,
    z.boolean(),
    true
  );
  const [ballotCopies, setBallotCopies] = useState(1);

  function changeLocale(localeCode: string) {
    return history.replace(
      localeCode === DEFAULT_LOCALE
        ? routerPaths.ballotsView({ precinctId, ballotStyleId })
        : routerPaths.ballotsViewLanguage({
            precinctId,
            ballotStyleId,
            localeCode,
          })
    );
  }

  const filename = getBallotPath({
    ballotStyleId,
    election,
    electionHash,
    precinctId,
    locales,
    ballotMode,
    isAbsentee,
  });

  function afterPrint(numCopies: number) {
    // TODO(auth) check permissions for viewing ballots
    const ballotType = isAbsentee
      ? PrintableBallotType.Absentee
      : PrintableBallotType.Precinct;
    void addPrintedBallotMutation.mutateAsync({
      ballotStyleId,
      precinctId,
      locales,
      numCopies,
      ballotType,
      ballotMode,
    });
    void logger.log(LogEventId.BallotPrinted, userRole, {
      message: `${numCopies} ${ballotMode} ${ballotType} ballots printed. Precinct: ${precinctId}, ballot style: ${ballotStyleId}`,
      disposition: 'success',
      ballotStyleId,
      precinctId,
      locales: getHumanBallotLanguageFormat(locales),
      ballotType,
      ballotMode,
      numCopies,
    });
  }

  function afterPrintError(errorMessage: string) {
    // TODO(auth) check permissions for viewing ballots
    void logger.log(LogEventId.BallotPrinted, userRole, {
      message: `Error attempting to print ballot: ${errorMessage}`,
      disposition: 'failure',
    });
  }

  const onRendered = useCallback(() => {
    if (ballotPreviewRef?.current && printBallotRef?.current) {
      ballotPreviewRef.current.innerHTML = printBallotRef.current.innerHTML;
    }
    // eslint-disable-next-line vx/gts-safe-number-parse
    const pagedJsPageCount = Number(
      (
        ballotPreviewRef.current?.getElementsByClassName(
          'pagedjs_pages'
        )[0] as HTMLElement
      )?.style.getPropertyValue('--pagedjs-page-count') || 0
    );
    setBallotPages(pagedJsPageCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ballotPreviewRef]);

  return (
    <React.Fragment>
      <NavigationScreen>
        <Prose maxWidth={false}>
          {isSuperBallotStyle(ballotStyleId) ? (
            <h1>
              Ballot Style <strong>All</strong> has{' '}
              <strong>
                {pluralize('contest', ballotContests.length, true)}
              </strong>
            </h1>
          ) : (
            <h1>
              Ballot Style <strong>{ballotStyleId}</strong> for {precinctName}{' '}
              has{' '}
              <strong>
                {pluralize('contest', ballotContests.length, true)}
              </strong>
            </h1>
          )}
          <p>
            {isElectionManagerAuth(auth) && (
              <React.Fragment>
                <BallotModeToggle
                  ballotMode={ballotMode}
                  setBallotMode={setBallotMode}
                />{' '}
              </React.Fragment>
            )}
            <BallotTypeToggle
              isAbsentee={isAbsentee}
              setIsAbsentee={setIsAbsentee}
            />{' '}
            Copies{' '}
            <BallotCopiesInput
              ballotCopies={ballotCopies}
              setBallotCopies={setBallotCopies}
            />
            {availableLocaleCodes.length > 1 && (
              <React.Fragment>
                {' '}
                <SegmentedButton>
                  {availableLocaleCodes.map((localeCode) => (
                    <Button
                      disabled={
                        currentLocaleCode
                          ? localeCode === currentLocaleCode
                          : localeCode === DEFAULT_LOCALE
                      }
                      key={localeCode}
                      onPress={() => changeLocale(localeCode)}
                      small
                    >
                      {getHumanBallotLanguageFormat({
                        primary: DEFAULT_LOCALE,
                        secondary:
                          localeCode === DEFAULT_LOCALE
                            ? undefined
                            : localeCode,
                      })}
                    </Button>
                  ))}
                </SegmentedButton>
              </React.Fragment>
            )}
          </p>
          <p>
            <PrintButton
              primary
              title={filename}
              afterPrint={() => afterPrint(ballotCopies)}
              afterPrintError={afterPrintError}
              copies={ballotCopies}
              sides="two-sided-long-edge"
              warning={ballotMode !== Admin.BallotMode.Official}
            >
              <PrintBallotButtonText
                ballotCopies={ballotCopies}
                ballotMode={ballotMode}
                isAbsentee={isAbsentee}
                election={election}
                localeCode={currentLocaleCode}
              />
            </PrintButton>
            {window.kiosk && (
              <React.Fragment>
                {' '}
                <Button
                  onPress={() => setIsSaveModalOpen(true)}
                  disabled={ballotPages === 0}
                >
                  Save Ballot as PDF
                </Button>
              </React.Fragment>
            )}
          </p>
          <p>
            <LinkButton small to={routerPaths.ballotsList}>
              Back to List Ballots
            </LinkButton>
          </p>
          {isElectionManagerAuth(auth) && (
            <p>
              Ballot Package Filename: <Monospace>{filename}</Monospace>
            </p>
          )}
          <h3>Ballot Preview</h3>
          {ballotPages > 0 && (
            <p>
              This ballot is <strong>{ballotPages} pages</strong> (printed front
              and back) on{' '}
              <strong>{pluralize('sheets', ballotPages / 2, true)}</strong> of{' '}
              <strong>
                {getBallotLayoutPageSizeReadableString(election)}-size
              </strong>{' '}
              paper.
            </p>
          )}
        </Prose>
        <BallotPreviewHeader>
          <h4>Front Pages</h4>
          <h4>Back Pages</h4>
        </BallotPreviewHeader>
        <BallotPreview ref={ballotPreviewRef}>
          <p>Rendering ballot preview…</p>
        </BallotPreview>
      </NavigationScreen>
      {isSaveModalOpen && (
        <SaveFileToUsb
          onClose={() => setIsSaveModalOpen(false)}
          generateFileContent={generateFileContentToSaveAsPdf}
          defaultFilename={filename}
          defaultDirectory={BALLOT_PDFS_FOLDER}
          fileType={FileType.Ballot}
        />
      )}
      <HandMarkedPaperBallot
        ballotStyleId={ballotStyleId}
        election={election}
        electionHash={electionHash}
        ballotMode={ballotMode}
        isAbsentee={isAbsentee}
        precinctId={precinctId}
        locales={locales}
        onRendered={onRendered}
      />
    </React.Fragment>
  );
}
