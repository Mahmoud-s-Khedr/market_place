import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import {
  CheckVerificationPayload,
  CheckVerificationResult,
  OtpVerificationProvider,
  StartVerificationPayload,
  StartVerificationResult,
} from './otp-sender.interface';

type AkedlyResponse<T> = {
  status?: string;
  code?: string;
  message?: string;
  data?: T;
};

type SendResponseData = {
  transactionReqID?: string;
};

@Injectable()
export class AkedlyOtpSender implements OtpVerificationProvider {
  constructor(private readonly configService: ConfigService<{ app: AppConfig }, true>) {}

  async startVerification(payload: StartVerificationPayload): Promise<StartVerificationResult> {
    if (!payload.powSolution) {
      throw new BadRequestException('powSolution is required');
    }

    const appConfig = this.configService.get('app', { infer: true });
    const response = await fetch(`${appConfig.akedlyBaseUrl}/api/v1.2/transactions/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(payload.endUserIp ? { 'x-end-user-ip': payload.endUserIp } : {}),
      },
      body: JSON.stringify({
        APIKey: appConfig.akedlyApiKey,
        pipelineID: appConfig.akedlyPipelineId,
        verificationAddress: { phoneNumber: this.normalizePhone(payload.phone) },
        powSolution: payload.powSolution,
        turnstileToken: payload.turnstileToken,
      }),
    });

    const result = await this.safeParse<AkedlyResponse<SendResponseData>>(response);
    if (!response.ok || result?.status === 'error') {
      this.throwMappedSendError(response.status, result);
    }

    const transactionReqID = result?.data?.transactionReqID;
    if (!transactionReqID) {
      throw new ServiceUnavailableException('OTP delivery failed: missing transactionReqID');
    }

    return { transactionReqID };
  }

  async checkVerification(payload: CheckVerificationPayload): Promise<CheckVerificationResult> {
    if (!payload.transactionReqID) {
      throw new BadRequestException('transactionReqID is required');
    }

    const appConfig = this.configService.get('app', { infer: true });
    const response = await fetch(`${appConfig.akedlyBaseUrl}/api/v1.2/transactions/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transactionReqID: payload.transactionReqID,
        otp: payload.code,
      }),
    });

    const result = await this.safeParse<AkedlyResponse<{ verified?: boolean }>>(response);
    if (!response.ok || result?.status === 'error' || !result?.data?.verified) {
      this.throwMappedVerifyError(response.status, result);
    }

    return {};
  }

  private throwMappedSendError(statusCode: number, result?: AkedlyResponse<SendResponseData>): never {
    const message = result?.message ?? 'OTP delivery failed';
    if (statusCode >= 400 && statusCode < 500) {
      throw new BadRequestException(message);
    }
    throw new ServiceUnavailableException(`OTP delivery failed: ${message}`);
  }

  private throwMappedVerifyError(statusCode: number, result?: AkedlyResponse<{ verified?: boolean }>): never {
    const code = result?.code;
    const message = result?.message ?? 'Invalid or expired OTP';
    if (code === 'ALREADY_VERIFIED') {
      throw new ConflictException(message);
    }
    if (code === 'INVALID_OTP' || code === 'TRANSACTION_EXPIRED' || (statusCode >= 400 && statusCode < 500)) {
      throw new BadRequestException(message);
    }
    throw new ServiceUnavailableException(`OTP verification failed: ${message}`);
  }

  private async safeParse<T>(response: Response): Promise<T | undefined> {
    try {
      return (await response.json()) as T;
    } catch {
      return undefined;
    }
  }

  private normalizePhone(phone: string): string {
    return phone.startsWith('+') ? phone : `+${phone}`;
  }
}
