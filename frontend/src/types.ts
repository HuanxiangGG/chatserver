export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  status: "ONLINE" | "BUSY" | "OFFLINE";
  lastSeenAt: string | null;
  role: string;
  banned?: boolean;
  isBanned?: boolean;
  createdAt?: string;
}
export interface Member {
  userId: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  user: User;
  lastReadAt: string | null;
  lastDeliveredAt: string | null;
}
export interface Attachment {
  id: string;
  originalName?: string;
  filename?: string;
  mimeType: string;
  size: number;
  url?: string;
}
export interface Message {
  forwardedFrom?: { senderName: string; sentAt: string } | null;
  id: string;
  conversationId: string;
  senderId: string;
  sender: User;
  content: string;
  createdAt: string;
  editedAt?: string | null;
  retractedAt?: string | null;
  deletedAt?: string | null;
  attachments: Attachment[];
  replyTo?: {
    id: string;
    content: string;
    sender?: User;
    retractedAt?: string | null;
    attachments?: Attachment[];
  } | null;
  clientId?: string;
  reads?: {
    userId: string;
    deliveredAt: string | null;
    readAt: string | null;
  }[];
}
export interface Conversation {
  id: string;
  type: "DIRECT" | "GROUP" | "CHANNEL";
  channel?: { id: string; serverId: string; readOnly: boolean; isPrivate: boolean } | null;
  canWrite?: boolean;
  unreadAnnouncements?: number;
  mute?: { permanent: boolean; until: string | null; reason: string } | null;
  name: string | null;
  description: string | null;
  avatarUrl: string | null;
  members: Member[];
  lastMessage: Message | null;
  unreadCount: number;
  updatedAt?: string;
}
export interface FriendRequest {
  id: string;
  senderId: string;
  receiverId: string;
  sender?: User;
  receiver?: User;
  from?: User;
  to?: User;
  createdAt: string;
  status: string;
}
export interface RequestList {
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
}
export interface AuditAction {
  id: string;
  action: string;
  targetId?: string;
  reason?: string;
  createdAt: string;
  admin?: User;
  metadata?: unknown;
}

export type ServerRole = 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER';
export interface Community {
  id: string; name: string; description: string; ownerId: string; role: ServerRole;
  _count?: { members: number };
}
export interface CommunityDetail extends Community {
  categories: { id: string; name: string; position: number }[];
  members: { userId: string; role: ServerRole; mutedUntil: string | null; user: User }[];
  channels: { id: string; conversationId: string; categoryId: string | null; position: number; isPrivate: boolean; readOnly: boolean; conversation: { name: string; description: string }; grants: { userId: string }[] }[];
}
