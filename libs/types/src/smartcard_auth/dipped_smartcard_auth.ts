import {
  AdminUser,
  CardProgramming,
  CardStorage,
  SuperadminUser,
  UserRole,
} from './auth';

export interface LoggedOut {
  readonly status: 'logged_out';
  readonly reason:
    | 'machine_locked'
    | 'card_error'
    | 'invalid_user_on_card'
    | 'user_role_not_allowed';
  readonly cardUserRole?: UserRole;
  readonly bootstrapAuthenticatedAdminSession: (electionHash: string) => void;
}

export interface CheckingPasscode {
  readonly status: 'checking_passcode';
  readonly user: SuperadminUser | AdminUser;
  readonly checkPasscode: (passcode: string) => void;
  readonly wrongPasscodeEnteredAt?: Date;
}

export interface RemoveCard {
  readonly status: 'remove_card';
  readonly user: SuperadminUser | AdminUser;
}

export interface SuperadminLoggedIn {
  readonly status: 'logged_in';
  readonly user: SuperadminUser;
  readonly card?: CardStorage & CardProgramming;
  readonly logOut: () => void;
}

export interface AdminLoggedIn {
  readonly status: 'logged_in';
  readonly user: AdminUser;
  readonly card?: CardStorage;
  readonly logOut: () => void;
}

export type LoggedIn = SuperadminLoggedIn | AdminLoggedIn;

export type Auth = LoggedOut | CheckingPasscode | RemoveCard | LoggedIn;
