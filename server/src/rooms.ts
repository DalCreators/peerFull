/**
 * rooms.ts
 * In-memory room & user state management.
 * Each room holds connected users, document state (as Yjs update bytes), and metadata.
 */

import * as Y from 'yjs';

// Palette of cursor colors assigned round-robin to users
const COLORS = [
  '#7c3aed', '#2563eb', '#16a34a', '#d97706',
  '#dc2626', '#0891b2', '#be185d', '#0d9488'
];

export interface User {
  id: string;
  username: string;
  color: string;
  currentFile?: string;
}

export class Room {
  public code: string;
  public hostId: string;
  public isPro: boolean;
  public users = new Map<string, User>();
  public callParticipants = new Set<string>();
  public createdAt = Date.now();
  public folderName: string = 'workspace';
  public folderSnapshot: Record<string, string> = {};

  // Yjs document — server maintains authoritative state
  private _ydoc = new Y.Doc();
  private _colorIndex = 0;

  constructor(code: string, hostId: string, hostUsername: string, isPro: boolean) {
    this.code = code;
    this.hostId = hostId;
    this.isPro = isPro;
    this.addUser(hostId, hostUsername);
  }

  addUser(id: string, username: string): User {
    const color = COLORS[this._colorIndex % COLORS.length];
    this._colorIndex++;
    const user: User = { id, username, color };
    this.users.set(id, user);
    return user;
  }

  removeUser(id: string) {
    this.users.delete(id);
  }

  applyUpdate(update: Uint8Array) {
    Y.applyUpdate(this._ydoc, update);
  }

  /** Get the current document content as a string */
  get documentContent(): string {
    return this._ydoc.getText('content').toString();
  }

  get isEmpty(): boolean {
    return this.users.size === 0;
  }
}

export class RoomManager {
  private _rooms = new Map<string, Room>();
  private _userRoomIndex = new Map<string, string>(); // userId -> roomCode

  createRoom(hostId: string, hostUsername: string, isPro: boolean): Room {
    const code = this._generateCode();
    const room = new Room(code, hostId, hostUsername, isPro);
    this._rooms.set(code, room);
    this._userRoomIndex.set(hostId, code);
    return room;
  }

  getRoom(code: string): Room | undefined {
    return this._rooms.get(code.toUpperCase());
  }

  addUser(roomCode: string, userId: string, username: string): User | undefined {
    const room = this._rooms.get(roomCode.toUpperCase());
    if (!room) return undefined;
    const user = room.addUser(userId, username);
    this._userRoomIndex.set(userId, roomCode.toUpperCase());
    return user;
  }

  removeUser(roomCode: string, userId: string) {
    const room = this._rooms.get(roomCode.toUpperCase());
    if (!room) return;
    room.removeUser(userId);
    this._userRoomIndex.delete(userId);

    // Clean up empty rooms to free memory
    if (room.isEmpty) {
      this._rooms.delete(roomCode.toUpperCase());
    }
  }

  getRoomForUser(userId: string): string | undefined {
    return this._userRoomIndex.get(userId);
  }

  private _generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // removed ambiguous chars
    let code: string;
    // Retry until unique
    do {
      code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    } while (this._rooms.has(code));
    return code;
  }
}
