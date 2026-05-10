import { Injectable } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

@Injectable()
export class ChatSocketRegistryService {
  private server: Server | null = null;
  private readonly socketsByUserId = new Map<number, Set<Socket>>();

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
    participantUserIds: number[],
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.server) {
      return;
    }

    const room = `conversation:${conversationId}`;
    const uniqueUserIds = [...new Set(participantUserIds)];
    for (const userId of uniqueUserIds) {
      const sockets = this.socketsByUserId.get(userId);
      if (!sockets) {
        continue;
      }
      for (const socket of sockets) {
        await socket.join(room);
      }
    }

    this.server.to(room).emit('conversation.joined', payload);
  }
}
