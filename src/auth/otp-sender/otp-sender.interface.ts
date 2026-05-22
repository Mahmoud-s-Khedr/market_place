export type OtpPurpose = 'registration' | 'password_reset';

export type StartVerificationPayload = {
  phone: string;
  purpose: OtpPurpose;
  userId: number | null;
  endUserIp?: string;
  powSolution?: {
    challengeToken: string;
    nonce: string | number;
  };
  turnstileToken?: string;
};

export type StartVerificationResult = {
  otp?: string;
  transactionReqID?: string;
};

export type CheckVerificationPayload = {
  phone: string;
  code: string;
  purpose: OtpPurpose;
  transactionReqID?: string;
};

export type CheckVerificationResult = {
  localOtpId?: number;
};

export interface OtpVerificationProvider {
  startVerification(payload: StartVerificationPayload): Promise<StartVerificationResult>;
  checkVerification(payload: CheckVerificationPayload): Promise<CheckVerificationResult>;
}

export const OTP_VERIFICATION_PROVIDER = Symbol('OTP_VERIFICATION_PROVIDER');
