import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

type SuccessEnvelope = {
  success: true;
  statusCode: number;
  data: unknown;
};

@Injectable()
export class HttpResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const response = context.switchToHttp().getResponse<{ statusCode?: number }>();

    return next.handle().pipe(
      map((data): SuccessEnvelope | unknown => {
        if (this.isAlreadyEnveloped(data)) {
          return data;
        }

        return {
          success: true,
          statusCode: response.statusCode ?? 200,
          data: this.normalizeData(data),
        };
      }),
    );
  }

  private isAlreadyEnveloped(data: unknown): boolean {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return false;
    }

    const payload = data as Record<string, unknown>;

    return (
      typeof payload.success === 'boolean' &&
      typeof payload.statusCode === 'number' &&
      Object.prototype.hasOwnProperty.call(payload, 'data')
    );
  }

  private normalizeData(data: unknown): unknown {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return data;
    }

    const payload = data as Record<string, unknown>;
    const keys = Object.keys(payload);
    if (keys.length !== 1) {
      return data;
    }

    const singleKey = keys[0];
    const value = payload[singleKey];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return value;
    }

    return {
      ...value as Record<string, unknown>,
      [singleKey]: value,
    };
  }
}
