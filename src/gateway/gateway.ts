import { Inject } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { 
	WebSocketGateway, 
	WebSocketServer,
	SubscribeMessage, 
	MessageBody, 
	OnGatewayConnection,
	ConnectedSocket,
	OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Socket, Server } from 'socket.io';
import { IConversationsService } from 'src/conversations/conversations';
import { Services } from 'src/utils/constants';
import { AuthenticatedSocket } from 'src/utils/interfaces';
import { Conversation, Group, GroupMessage, Message } from 'src/utils/typeorm';
import { 
	CreateGroupMessageResponse, 
	CreateMessageResponse 
} from 'src/utils/types';
import { IGatewaySessionManager } from './gateway.session';

@WebSocketGateway({
	cors: {
		origin: ['http://localhost:3000'],
		credentials: true,
	},
})
export class MessagingGateway implements OnGatewayConnection {
	constructor(
		@Inject(Services.GATEWAY_SESSION_MANAGER) 
		private readonly sessions: IGatewaySessionManager,
		@Inject(Services.CONVERSATIONS)
		private readonly conversationService: IConversationsService,
	) {}

	@WebSocketServer()
	server: Server;

	handleConnection(socket: AuthenticatedSocket, ...args: any[]) {
		console.log('Incoming Connection');
		console.log(socket.user);
		this.sessions.setUserSocket(socket.user.id, socket);
		socket.emit('connected', {});
	}

	@SubscribeMessage('getOnlineGroupUsers')
	handleGetOnlineGroupUsers(@MessageBody() data: any) {
		console.log('handleGetOnlineGroupUsers');
		console.log(data);
		const clientsInRoom = this.server.sockets.adapter.rooms.get(
			`group-${data.goupId}`,
		);
		console.log(clientsInRoom);
		this.sessions.getSockets().forEach((socket) => {
			if (clientsInRoom.has(socket.id)) {
				console.log(socket.user.email + ' is online');
			}
		});
	}

	// handleDisconnect(client: AuthenticatedSocket) {
	// 	console.log('Client Disconnect');
	// }

	// @SubscribeMessage('onConnect')
	// handleOnConnect(@ConnectedSocket() client: AuthenticatedSocket) {
	// 	this.sessions.setUserSocket
	// }

	@SubscribeMessage('createMessage')
	handleCreateMessage(@MessageBody() data: any) {
		console.log('Create Message');
	}

	@SubscribeMessage('onConversationJoin')
	onConversationJoin(
		@MessageBody() data: any,
		@ConnectedSocket() client: AuthenticatedSocket,
	) {
		console.log(
			`${client.user?.id} joined a Conversation of ID: ${data.conversationId}`,
		);
		client.join(`conversation-${data.conversationId}`);
		console.log(client.rooms);
		client.to(`conversation-${data.conversationId}`).emit('userJoin');
	}

	@SubscribeMessage('onConversationLeave')
	onConversationLeave(
		@MessageBody() data: any,
		@ConnectedSocket() client: AuthenticatedSocket,
	) {
		console.log('onConversationLeave');
		client.join(`conversation-${data.conversationId}`);
		console.log(client.rooms);
		client.to(`conversation-${data.conversationId}`).emit('userLeave');
	}

	@SubscribeMessage('onGroupJoin')
	onGroupJoin(
		@MessageBody() data: any,
		@ConnectedSocket() client: AuthenticatedSocket,
	) {
		console.log('onGroupJoin');
		client.join(`group-${data.groupId}`);
		console.log(client.rooms);
		client.to(`group-${data.groupId}`).emit('userGroupJoin');
	}

	@SubscribeMessage('onGroupLeave')
	onGroupLeave(
		@MessageBody() data: any,
		@ConnectedSocket() client: AuthenticatedSocket,
	) {
		console.log('onGroupLeave');
		client.join(`group-${data.groupId}`);
		console.log(client.rooms);
		client.to(`group-${data.groupId}`).emit('userGroupLeave');
	}

	@SubscribeMessage('onTypingStart')
	onTypingStart(
		@MessageBody() data: any,
		@ConnectedSocket() client: AuthenticatedSocket,
	) {
		console.log('onTypingStart');
		console.log(data.conversationId);
		console.log(client.rooms);
		client.to(`conversation-${data.conversationId}`).emit('onTypingStart');
	}

	@SubscribeMessage('onTypingStop')
	onTypingStop(
		@MessageBody() data: any,
		@ConnectedSocket() client: AuthenticatedSocket,
	) {
		console.log('onTypingStop');
		console.log(data.conversationId);
		console.log(client.rooms);
		client.to(`conversation-${data.conversationId}`).emit('onTypingStop');
	}

	@OnEvent('message.create')
	handleMessageCreateEvent(payload: CreateMessageResponse) {
		console.log('Inside message.create');
		console.log(payload);
		const { 
			author, 
			conversation: { creator, recipient },
		} = payload.message;

		const authorSocket = this.sessions.getUserSocket(author.id);
		const recipientSocket = 
			author.id === creator.id 
				? this.sessions.getUserSocket(recipient.id) 
				: this.sessions.getUserSocket(creator.id);

		if (authorSocket) authorSocket.emit('onMessage', payload);
		console.log(authorSocket);
		console.log(recipientSocket);
		if (recipientSocket) recipientSocket.emit('onMessage', payload);
	}

	@OnEvent('conversation.create')
	handleConversationCreateEvent(payload: Conversation) {
		console.log('Inside conversation.create');
		console.log(payload.recipient);
		const recipientSocket = this.sessions.getUserSocket(payload.recipient.id);
		if (recipientSocket) recipientSocket.emit('onConversation', payload);
	}

	@OnEvent('message.delete')
	async handleMessageDelete(payload) {
		console.log('Inside message.delete');
		console.log(payload);
		const conversation = await this.conversationService.findConversationById(
			payload.conversationId,
		);
		if (!conversation) return;
		const { creator, recipient } = conversation;
		const recipientSocket = creator.id === payload.userId
			? this.sessions.getUserSocket(recipient.id)
			: this.sessions.getUserSocket(creator.id);
		if (recipientSocket) recipientSocket.emit('onMessageDelete', payload);
	}

	@OnEvent('message.update')
	async handleMessageUpdate(message: Message) {
		const {
			author,
			conversation: { creator, recipient },
		} = message;
		console.log(message);
		const recipientSocket = 
			author.id === creator.id
				? this.sessions.getUserSocket(recipient.id)
				: this.sessions.getUserSocket(creator.id);
		if (recipientSocket) recipientSocket.emit('onMessageUpdate', message);
	}

	@OnEvent('group.message.create')
	async handleGroupMessageCreate(payload: CreateGroupMessageResponse) {
		const { id } = payload.group;
		console.log('Inside group.message.create');
		this.server.to(`group-${id}`).emit('onGroupMessage', payload);
	}

	@OnEvent('group.create')
	handleGroupCreate(payload: Group) {
		console.log('group.create event');
		payload.users.forEach((user) => {
			const socket = this.sessions.getUserSocket(user.id);
			socket && socket.emit('onGroupCreate', payload);
		});
	}

	@OnEvent('group.message.update')
	handleGroupMessageUpdate(payload: GroupMessage) {
		const room = `group-${payload.group.id}`;
		console.log(room);
		this.server.to(room).emit('onGroupMessageUpdate', payload);
	}
}
