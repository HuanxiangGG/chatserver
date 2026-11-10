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
  type: "DIRECT" | "GROUP" | "CHANNEL" | "TICKET";
  channel?: { id: string; serverId: string; readOnly: boolean; isPrivate: boolean } | null;
  ticket?: { id:string; serverId:string; status:string; memberId:string; assigneeId:string|null } | null;
  canWrite?: boolean;
  canUpload?: boolean;
  permissions?:Partial<CommunityPermissions>|null;
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
export type CommunityPermissions = Record<'view'|'send'|'upload'|'manageMessages'|'manageChannels'|'installBots'|'handleTickets',boolean>;
export interface CommunityRole {id:string;name:string;position:number;permissions:Partial<CommunityPermissions>;members:{userId:string}[]}
export interface Community {
  id: string; name: string; description: string; ownerId: string; role: ServerRole;
  rules?:string; iconUrl?:string|null;
  _count?: { members: number };
}
export interface CommunityDetail extends Community {
  permissions: CommunityPermissions;
  roles: CommunityRole[];
  categories: { id: string; name: string; position: number }[];
  members: { userId: string; role: ServerRole; mutedUntil: string | null; ticketEligible: boolean; user: User }[];
  channels: { id: string; conversationId: string; categoryId: string | null; position: number; isPrivate: boolean; readOnly: boolean; archivedAt?:string|null; permissions:CommunityPermissions; permissionOverrides?:Partial<CommunityPermissions>; roleOverrides?:{roleId:string;permissions:Partial<CommunityPermissions>}[]; conversation: { name: string; description: string }; grants: { userId: string }[] }[];
}
