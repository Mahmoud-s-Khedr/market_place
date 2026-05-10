import { Injectable } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { AppLogger } from '../common/logging/app-logger.service';

@Injectable()
export class ChatSocketRegistryService {
  private server: Server | null = null;
  private readonly socketsByUserId = new Map<number, Set<Socket>>();

  constructor(private readonly appLogger: AppLogger) {}

  setServer(server: Server): void {
    this.server = server;
  }

  registerUserSocket(userId: number, socket: Socket): void {
    const sockets = this.socketsByUserId.get(userId) ?? new Set<Socket>();
    sockets.add(socket);
    this.socketsByUserId.set(userId, sockets);
  }

  unregisterUserSocket(userId: number, socket: Socket): void {
    const sockets = this.socketsByUserId.get(userId);
    if (!sockets) {
      return;
    }
    sockets.delete(socket);
    if (sockets.size === 0) {
      this.socketsByUserId.delete(userId);
    }
  }

  async emitConversationJoinedToParticipants(
    conversationId: number,
    participantUserIds: Array<number | string>,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.server) {
      return;
    }

    const room = `conversation:${conversationId}`;
    const normalizedUserIds = participantUserIds
      .map((id) => this.toPositiveInt(id))
      .filter((id): id is number => id !== null);
    const uniqueUserIds = [...new Set(normalizedUserIds)];
    const matchedSocketsByUserId: Record<string, number> = {};

    for (const userId of uniqueUserIds) {
      const sockets = this.socketsByUserId.get(userId);
      matchedSocketsByUserId[String(userId)] = sockets?.size ?? 0;
      if (!sockets) {
        continue;
      }
      for (const socket of sockets) {
        await socket.join(room);
      }
    }

    this.server.to(room).emit('conversation.joined', payload);
    this.appLogger.debug({
      service: 'chat-ws',
      protocol: 'ws',
      routeOrEvent: 'conversation.joined',
      message: 'REST-triggered room join emit',
      userId: null,
      meta: {
        conversationId,
        room,
        participantUserIds,
        normalizedParticipantUserIds: uniqueUserIds,
        matchedSocketsByUserId,
      },
    });
  }

  private toPositiveInt(value: unknown): number | null {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return null;
  }
}
