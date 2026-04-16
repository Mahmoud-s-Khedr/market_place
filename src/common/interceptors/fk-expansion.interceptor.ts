import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from, mergeMap } from 'rxjs';
import { FkExpansionService } from '../relations/fk-expansion.service';

@Injectable()
export class FkExpansionInterceptor implements NestInterceptor {
  constructor(private readonly fkExpansionService: FkExpansionService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    return next.handle().pipe(
      mergeMap((data) => from(this.fkExpansionService.expand(data))),
    );
  }
}
