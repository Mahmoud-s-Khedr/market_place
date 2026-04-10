export type OtpPurpose = 'registration' | 'password_reset';

export type OtpPayload = {
  phone: string;
  otp: string;
  purpose: OtpPurpose;
};

export interface OtpSender {
  sendOtp(payload: OtpPayload): Promise<void>;
}

export const OTP_SENDER = Symbol('OTP_SENDER');
