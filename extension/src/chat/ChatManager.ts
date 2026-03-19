/**
 * ChatManager.ts
 * Handles text chat messages over the Socket.io connection.
 * Listens for incoming messages and exposes a send API.
 */

import { Socket } from 'socket.io-client';

export interface ChatMessage {
  id: string;
  username: string;
  text: string;
  timestamp: number;
  isMe: boolean;
}

type MessageCallback = (msg: ChatMessage) => void;

export class ChatManager {
  private _socket: Socket | null = null;
  private _callbacks: MessageCallback[] = [];
  private _myId: string | null = null;
  private _username = 'Anonymous';

  /** Attach to an already-connected socket */
  connect(socket: Socket) {
    this._socket = socket;
    this._myId = socket.id ?? null;

    socket.on('chat-message', (msg: ChatMessage) => {
      const enriched: ChatMessage = {
        ...msg,
        isMe: msg.id === this._myId
      };
      this._callbacks.forEach(cb => cb(enriched));
    });

    // Update our own id on reconnect
    socket.on('connect', () => {
      this._myId = socket.id ?? null;
    });
  }

  disconnect() {
    this._socket?.off('chat-message');
    this._socket = null;
  }

  sendMessage(text: string) {
    if (!this._socket || !text.trim()) return;
    this._socket.emit('chat-message', { text: text.trim() });
  }

  onMessage(cb: MessageCallback) {
    this._callbacks.push(cb);
  }
}
