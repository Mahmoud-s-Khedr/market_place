import { Injectable } from '@nestjs/common';
import { FkExpansionService } from '../common/relations/fk-expansion.service';

@Injectable()
export class ChatJoinedPayloadBuilder {
  constructor(private readonly fkExpansionService: FkExpansionService) {}

  async buildConversationJoinedPayload(
    conversationResponse: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const expanded = await this.fkExpansionService.expand(conversationResponse) as Record<string, unknown>;
    return {
      success: true,
      statusCode: 200,
      data: (expanded as { conversation?: unknown }).conversation ?? null,
    };
  }
}
