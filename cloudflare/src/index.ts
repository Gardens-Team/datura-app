import { DurableObject } from "cloudflare:workers";
import { createClient } from '@supabase/supabase-js';

// Define the Env interface with the DATURA_CHANNELS binding
interface Env {
	DATURA_CHANNELS: DurableObjectNamespace;
	// Environment variables
	KEY_ROTATION_HOURS?: string;
	EPHEMERAL_MESSAGE_DEFAULT_TTL?: string;
	MAX_MESSAGE_CACHE?: string;
	SUPABASE_URL: string;
	SUPABASE_KEY: string;
}

/**
 * Datura - End-to-End Encrypted Chat with Forward Secrecy
 *
 * This Durable Object implementation provides:
 * - Secure message caching and relay
 * - Key rotation for forward secrecy
 * - Encrypted channel management
 * - Ephemeral message support
 */

// Interface for a Datura message
interface DaturaMessage {
	id: string;
	ciphertext: string;
	channelId: string;
	senderId: string;
	timestamp: number;
	keyVersion: number;
	ephemeral?: boolean;
	expiresAt?: number;
	messageType?: string;
	nonce?: string;
	mentionedUsers?: string[];
	username?: string;
	profile_pic?: string;
}

// Interface for a Datura message
interface DaturaConversation {
	id: string;
	ciphertext: string;
	senderId: string;
	recipientId: string;
	senderKey: string;
	recipientKey: string;
	read: boolean;
	messageType: 'Text' | 'Image' | 'Video' | 'Audio' | 'File';
	ephemeral: boolean;
}

// Interface for key rotation
interface ChannelKeys {
	channelId: string;
	currentKeyVersion: number;
	keyRotationTimestamp: number;
	rotationPeriodHours: number;
	keyGenerations: Map<number, {
		createdAt: number;
		validUntil: number;
		publicKeyMaterial: string;
	}>;
}

// Interface for a channel state
interface ChannelState {
	id: string;
	name?: string;
	keys: ChannelKeys;
	participantIds: string[];
	createdAt: number;
	lastActivity: number;
	messageCount: number;
	gardenId?: string;
}

interface ChannelSetupData {
	channelData: {
		id: string;
		name: string;
		created_at: string;
	};
	participants: string[];
	keyData: {
		key_version: number;
		created_at: string;
		valid_until: string;
		public_key_material: string;
	};
}

// Interface for a Supabase message
interface SupabaseMessage {
	id: string;
	channelId: string;
	senderId: string;
	ciphertext: string;
	createdAt: string;
	nonce: string;
	keyVersion: number;
	ephemeral: boolean;
	expiresAt: string | null;
	messageType: string;
	gardenId?: string;
}

export class DaturaChannelDO extends DurableObject<Env> {
	private channel: ChannelState | null = null;
	private messages: Map<string, DaturaMessage> = new Map();
	private sessions: Set<WebSocket> = new Set();
	private keyRotationTask: NodeJS.Timeout | null = null;
	private supabase: any;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);

		// Initialize Supabase client
		this.supabase = createClient(
			env.SUPABASE_URL,
			env.SUPABASE_KEY
		);

		console.log(`Initializing Supabase with URL: ${env.SUPABASE_URL}`);
		console.log(`Supabase key exists: ${!!env.SUPABASE_KEY}`);

		// Initialize state when object is created
		this.initialize(ctx).catch(err => {
			console.error("Failed to initialize DaturaChannelDO:", err);
		});
	}

	async initialize(ctx: DurableObjectState): Promise<void> {
		// Load state or create new channel
		this.channel = await ctx.storage.get("channel") as ChannelState || null;

		if (this.channel) {
			console.log(`Initialized channel ${this.channel.id} from storage`);

			// Get the channel's ID
			const channelId = this.channel.id;

			// Ensure we have a channel-specific key in storage
			if (channelId) {
				const specificChannel = await ctx.storage.get(`channel:${channelId}`);
				if (!specificChannel) {
					// Store with specific ID for easier lookup
					await ctx.storage.put(`channel:${channelId}`, this.channel);
					console.log(`Created specific storage key for channel ${channelId}`);
				}
			}

			// We no longer load cached messages from DO storage
			// Instead, all messages are retrieved from Supabase
			console.log(`Channel initialized - messages will be fetched from Supabase`);

			// Schedule key rotation
			this.scheduleKeyRotation();
		} else {
			console.log("No channel found in storage during initialization");
		}

		// Listen for storage changes
		ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000); // Set daily alarm
	}

	/**
	 * The main fetch handler for HTTP requests
	 */
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname.slice(1).split('/').filter(p => p);

		// Log every incoming request for debugging
		console.log(`Received request: ${request.method} ${url.pathname}${url.search}`);

		// Check for WebSocket upgrade
		const upgradeHeader = request.headers.get('Upgrade');
		if (upgradeHeader && upgradeHeader.toLowerCase() === 'websocket') {
			// Handle all WebSocket connections through the WebSocket handler
			return this.handleWebSocketConnection(request);
		}

		// Handle setup endpoint from Supabase
		if (path.length > 1 && path[0] === 'channel' && path[2] === 'setup') {
			return this.handleSetupFromSupabase(request);
		}

		// All other requests use standard HTTP
		if (path[0] === 'channel') {
			switch (path[1]) {
				case 'create':
					return this.handleCreateChannel(request);
				case 'join':
					return this.handleJoinChannel(request);
				case 'info':
					return this.handleChannelInfo();
				case 'rotate-keys':
					return this.handleManualKeyRotation(request);
				default:
					if (upgradeHeader && upgradeHeader.toLowerCase() === 'websocket') {
						// Handle WebSocket upgrade for /channel/{channelId} format
						return this.handleWebSocketConnection(request);
					}
					break;
			}
		} else if (path[0] === 'websocket') {
			// Handle legacy WebSocket connections
			return this.handleWebSocketConnection(request);
		} else if (path[0] === 'messages') {
			switch (path[1]) {
				case 'send':
					return this.handleSendMessage(request);
				case 'history':
					return this.handleGetMessageHistory(request);
				case 'ephemeral':
					return this.handleCreateEphemeralMessage(request);
				default:
					break;
			}
		}

		return new Response(JSON.stringify({
			error: "Not found",
			message: "The requested resource was not found",
			path: url.pathname
		}), {
			status: 404,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	/**
	 * Handle WebSocket connections for real-time messaging
	 */
	async handleWebSocketConnection(request: Request): Promise<Response> {
		const url = new URL(request.url);
		let channelId: string | null = null;

		// Extract channelId from various URL patterns
		const pathParts = url.pathname.split('/').filter(p => p);

		// Try to find the channelId
		if (pathParts[0] === 'channel' && pathParts.length > 1) {
			// Format: /channel/{channelId}
			channelId = pathParts[1];
			console.log(`Found channelId in path: ${channelId}`);
		} else if (pathParts[0] === 'websocket') {
			// Format: /websocket?channelId={channelId}
			channelId = url.searchParams.get('channelId');
			console.log(`Found channelId in query param: ${channelId}`);
		}

		// If we still don't have a channelId, check query params as fallback
		if (!channelId) {
			channelId = url.searchParams.get('channelId');
			console.log(`Fallback to query param channelId: ${channelId}`);
		}

		console.log(`WebSocket connection attempt for channelId: ${channelId}, URL: ${url.pathname}`);

		// Load channel data from storage if needed
		if (!this.channel) {
			try {
				// Try to load the channel from storage
				const stored = await this.ctx.storage.get("channel");
				if (stored) {
					this.channel = stored as ChannelState;
					console.log(`Loaded channel ${this.channel.id} from storage`);
				} else if (channelId) {
					// Try to load the specific channel requested
					const channelData = await this.ctx.storage.get(`channel:${channelId}`);
					if (channelData) {
						this.channel = channelData as ChannelState;
						console.log(`Loaded requested channel ${this.channel.id} from storage`);
					} else {
						console.log(`Channel not found: ${channelId}`);
						return new Response(JSON.stringify({
							error: "Channel not found",
							message: "The requested channel does not exist or is not initialized.",
							channelId
						}), {
							status: 404,
							headers: { 'Content-Type': 'application/json' }
						});
					}
				} else {
					console.log("No channel state found and no channelId provided");
					return new Response(JSON.stringify({
						error: "Channel not specified",
						message: "Please provide a channelId parameter"
					}), {
						status: 400,
						headers: { 'Content-Type': 'application/json' }
					});
				}
			} catch (err) {
				console.error("Error loading channel:", err);
				return new Response(JSON.stringify({
					error: "Failed to load channel",
					message: err instanceof Error ? err.message : String(err),
					channelId
				}), {
					status: 500,
					headers: { 'Content-Type': 'application/json' }
				});
			}
		}

		// Accept the WebSocket connection
		const upgradeHeader = request.headers.get('Upgrade');
		if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
			return new Response(JSON.stringify({
				error: "Not a WebSocket request",
				message: "Expected WebSocket upgrade header"
			}), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Extract user authentication from the request
		const userId = url.searchParams.get('userId');
		const authToken = url.searchParams.get('auth');

		if (!userId || !authToken) {
			return new Response(JSON.stringify({
				error: "Authentication required",
				message: "Both userId and auth parameters are required"
			}), {
				status: 401,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Validate the user has access to this channel
		if (!this.channel.participantIds.includes(userId)) {
			console.log(`WebSocket connection rejected: User ${userId} is not a channel member. Current participants: ${this.channel.participantIds.join(', ')}`);
			return new Response(JSON.stringify({
				error: "Access denied",
				message: "Not a channel member",
				userId,
				channel: this.channel.id,
				participants: this.channel.participantIds
			}), {
				status: 403,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		try {
			// Create the WebSocket pair
			const webSocketPair = new WebSocketPair();
			const [client, server] = Object.values(webSocketPair);

			// Use the hibernatable WebSocket API
			this.ctx.acceptWebSocket(server);

			// Send current key information to the client
			server.send(JSON.stringify({
				type: "key_info",
				channelId: this.channel.id,
				keyVersion: this.channel.keys.currentKeyVersion,
				publicKeyMaterial: this.channel.keys.keyGenerations.get(this.channel.keys.currentKeyVersion)?.publicKeyMaterial,
				timestamp: Date.now()
			}));

			// Return the client socket for the caller to use
			return new Response(null, {
				status: 101,
				webSocket: client,
			});
		} catch (error) {
			console.error("Error establishing WebSocket connection:", error);
			return new Response(JSON.stringify({
				error: "WebSocket connection failed",
				message: error instanceof Error ? error.message : String(error)
			}), {
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}

	/**
	 * WebSocket message handler - called by the runtime when a message is received
	 */
	async webSocketMessage(ws: WebSocket, message: string): Promise<void> {
		try {
			console.log(`[WebSocket] Received message: ${message.substring(0, 100)}...`);
			const data = JSON.parse(message);

			// Extract message data - either directly in data or in data.data
			const messageData = data.data || data;

			// Use the senderId from the message payload instead of trying to extract from URL
			// This ensures we use the same ID that the client set
			const senderId = messageData.senderId;

			if (!senderId) {
				console.error("[WebSocket] Missing sender in message payload");
				ws.send(JSON.stringify({
					type: "error",
					message: "Missing sender in message payload"
				}));
				return;
			}

			console.log(`[WebSocket] Message type: ${data.type}, senderId: ${senderId}`);

			if (data.type === "chat_message" || data.type === "message") {
				// Handle incoming message
				const msgId = crypto.randomUUID();

				// Handle both formats - check if the message is in data.data (client format) or directly in data
				console.log(`[WebSocket] Processing message format: ${data.data ? 'client-format' : 'direct-format'}`);

				const daturaMessage: DaturaMessage = {
					id: msgId,
					ciphertext: messageData.ciphertext,
					channelId: this.channel!.id,
					senderId: senderId, // Use the senderId from the message
					timestamp: Date.now(),
					keyVersion: this.channel!.keys.currentKeyVersion,
					messageType: messageData.messageType || 'Text',
					nonce: messageData.nonce,
					ephemeral: messageData.ephemeral || false,
					expiresAt: messageData.ephemeral ? Date.now() + (messageData.ttlSeconds || 86400) * 1000 : undefined,
					mentionedUsers: messageData.mentionedUsers || []
				};

				console.log(`[WebSocket] Prepared Datura message with ID ${msgId}, message type: ${daturaMessage.messageType}`);

				// Store message and relay to other clients
				try {
					await this.storeAndRelayMessage(daturaMessage);
					console.log(`[WebSocket] Successfully stored and relayed message ${msgId}`);
				} catch (storeError) {
					console.error(`[WebSocket] Error in storeAndRelayMessage:`, storeError);
					throw storeError;
				}

				// Send confirmation to the sender
				ws.send(JSON.stringify({
					type: "message_confirmation",
					messageId: msgId,
					timestamp: daturaMessage.timestamp
				}));
			} else if (data.type === "key_request") {
				// Client is requesting historical keys (for history loading)
				const keyVersion = parseInt(data.keyVersion);
				const keyInfo = this.channel!.keys.keyGenerations.get(keyVersion);

				if (keyInfo) {
					ws.send(JSON.stringify({
						type: "key_info",
						keyVersion,
						publicKeyMaterial: keyInfo.publicKeyMaterial,
						timestamp: Date.now()
					}));
				}
			}
		} catch (err) {
			console.error("Error handling WebSocket message:", err);
			ws.send(JSON.stringify({
				type: "error",
				message: "Failed to process message",
				error: err instanceof Error ? err.message : String(err)
			}));
		}
	}

	/**
	 * WebSocket close handler - called by the runtime when connection is closed
	 */
	async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
		try {
			// Get WebSocket URL to extract userId
			let userId = 'unknown';

			try {
				if (ws.url) {
					const url = new URL(ws.url);
					const urlUserId = url.searchParams.get('userId');
					if (urlUserId) {
						userId = urlUserId;
					}
				}
			} catch (err) {
				console.warn("Could not parse WebSocket URL in close handler:", err);
			}

			console.log(`WebSocket closed for user ${userId} in channel ${this.channel?.id}, code: ${code}, reason: ${reason}, clean: ${wasClean}`);
		} catch (error) {
			console.error("Error in webSocketClose handler:", error);
		}
	}

	/**
	 * WebSocket error handler - called by the runtime when connection has an error
	 */
	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		try {
			// Get WebSocket URL to extract userId
			let userId = 'unknown';

			try {
				if (ws.url) {
					const url = new URL(ws.url);
					const urlUserId = url.searchParams.get('userId');
					if (urlUserId) {
						userId = urlUserId;
					}
				}
			} catch (err) {
				console.warn("Could not parse WebSocket URL in error handler:", err);
			}

			console.error(`WebSocket error for user ${userId} in channel ${this.channel?.id}:`, error);
		} catch (err) {
			console.error("Error in webSocketError handler:", err);
		}
	}

	/**
	 * Create a new E2EE channel
	 */
	async handleCreateChannel(request: Request): Promise<Response> {
		if (this.channel) {
			return new Response("Channel already exists", { status: 400 });
		}

		const { channelId, name, creatorId, initialParticipantIds, initialPublicKeyMaterial } = await request.json() as {
			channelId: string;
			name?: string;
			creatorId: string;
			initialParticipantIds?: string[];
			initialPublicKeyMaterial: string;
		};

		if (!channelId || !creatorId || !initialPublicKeyMaterial) {
			return new Response("Missing required fields", { status: 400 });
		}

		// Create a new channel with key rotation parameters
		const rotationPeriodHours = 24; // Rotate keys daily by default

		// Initialize the keyGenerations Map with the first key generation
		const keyGenerations = new Map();
		keyGenerations.set(1, {
			createdAt: Date.now(),
			validUntil: Date.now() + rotationPeriodHours * 60 * 60 * 1000,
			publicKeyMaterial: initialPublicKeyMaterial
		});

		this.channel = {
			id: channelId,
			name: name || "Secure Channel",
			keys: {
				channelId,
				currentKeyVersion: 1,
				keyRotationTimestamp: Date.now(),
				rotationPeriodHours,
				keyGenerations
			},
			participantIds: [creatorId, ...(initialParticipantIds || [])],
			createdAt: Date.now(),
			lastActivity: Date.now(),
			messageCount: 0
		};

		// Persist the channel state
		await this.ctx.storage.put("channel", this.channel);

		// Schedule key rotation
		this.scheduleKeyRotation();

		return new Response(JSON.stringify({
			success: true,
			channelId,
			keyVersion: 1
		}), {
			headers: { "Content-Type": "application/json" }
		});
	}

	/**
	 * Join an existing channel
	 */
	async handleJoinChannel(request: Request): Promise<Response> {
		if (!this.channel) {
			return new Response("Channel not found", { status: 404 });
		}

		const { userId, userPublicKey } = await request.json() as {
			userId: string;
			userPublicKey: string;
		};

		if (!userId || !userPublicKey) {
			return new Response("Missing required fields", { status: 400 });
		}

		// Don't add user if already a participant
		if (this.channel.participantIds.includes(userId)) {
			// But do return the current key info
			return new Response(JSON.stringify({
				success: true,
				channelId: this.channel.id,
				keyVersion: this.channel.keys.currentKeyVersion,
				publicKeyMaterial: this.channel.keys.keyGenerations.get(this.channel.keys.currentKeyVersion)?.publicKeyMaterial
			}), {
				headers: { "Content-Type": "application/json" }
			});
		}

		// Add user to channel participants
		this.channel.participantIds.push(userId);
		this.channel.lastActivity = Date.now();

		// Persist updated channel state
		await this.ctx.storage.put("channel", this.channel);

		// Notify other participants about new member
		this.broadcastToSessions({
			type: "channel_update",
			event: "member_joined",
			userId,
			timestamp: Date.now()
		});

		return new Response(JSON.stringify({
			success: true,
			channelId: this.channel.id,
			keyVersion: this.channel.keys.currentKeyVersion,
			publicKeyMaterial: this.channel.keys.keyGenerations.get(this.channel.keys.currentKeyVersion)?.publicKeyMaterial
		}), {
			headers: { "Content-Type": "application/json" }
		});
	}

	/**
	 * Get information about the channel
	 */
	async handleChannelInfo(): Promise<Response> {
		if (!this.channel) {
			return new Response("Channel not found", { status: 404 });
		}

		return new Response(JSON.stringify({
			id: this.channel.id,
			name: this.channel.name,
			participantCount: this.channel.participantIds.length,
			messageCount: this.channel.messageCount,
			createdAt: this.channel.createdAt,
			lastActivity: this.channel.lastActivity,
			currentKeyVersion: this.channel.keys.currentKeyVersion,
			nextRotationAt: this.calculateNextRotationTime()
		}), {
			headers: { "Content-Type": "application/json" }
		});
	}

	/**
	 * Trigger a manual key rotation
	 */
	async handleManualKeyRotation(request: Request): Promise<Response> {
		if (!this.channel) {
			return new Response("Channel not found", { status: 404 });
		}

		const { adminId, newPublicKeyMaterial } = await request.json() as {
			adminId: string;
			newPublicKeyMaterial: string;
		};

		// Verify authorization (first user is considered admin for simplicity)
		if (adminId !== this.channel.participantIds[0]) {
			return new Response("Unauthorized", { status: 403 });
		}

		if (!newPublicKeyMaterial) {
			return new Response("Missing new key material", { status: 400 });
		}

		// Perform key rotation
		await this.rotateKeys(newPublicKeyMaterial);

		return new Response(JSON.stringify({
			success: true,
			channelId: this.channel.id,
			newKeyVersion: this.channel.keys.currentKeyVersion
		}), {
			headers: { "Content-Type": "application/json" }
		});
	}

	/**
	 * Send a message to the channel
	 */
	async handleSendMessage(request: Request): Promise<Response> {
		const url = new URL(request.url);
		console.log(`Handling message send request: ${url.pathname}${url.search}`);

		// Get the channel ID - either from path or query params
		let channelId: string | null = null;

		// Check if this is a request that came through the new routing
		// where the channelId was added as a query param
		const queryChannelId = url.searchParams.get('channelId');
		if (queryChannelId) {
			channelId = queryChannelId;
			console.log(`Using channelId from query parameter: ${channelId}`);
		} else {
			// Try to extract from the path (legacy format)
			const pathParts = url.pathname.slice(1).split('/').filter(p => p);
			if (pathParts.length >= 2 && pathParts[0] === 'channel') {
				channelId = pathParts[1];
				console.log(`Using channelId from path: ${channelId}`);
			}
		}

		// Ensure we have a channel ID and try to load the channel if not already loaded
		if (!this.channel && channelId) {
			try {
				// Try to load the specific channel requested
				const channelData = await this.ctx.storage.get(`channel:${channelId}`);
				if (channelData) {
					this.channel = channelData as ChannelState;
					console.log(`Loaded requested channel ${this.channel.id} from storage for sending message`);

					// Load messages if needed
					if (this.messages.size === 0) {
						const cachedMessages = await this.ctx.storage.get(`messages:${channelId}`) as Map<string, DaturaMessage> || new Map();
						this.messages = cachedMessages;
						console.log(`Loaded ${this.messages.size} cached messages for channel ${channelId}`);
					}
				}
			} catch (error) {
				console.error(`Error loading channel data for ${channelId}:`, error);
			}
		}

		if (!this.channel) {
			console.error(`Channel not found for message send request. ChannelId: ${channelId || 'unknown'}`);
			return new Response(JSON.stringify({
				error: "Channel not found",
				message: "The requested channel does not exist or is not initialized",
				channelId: channelId || 'unknown'
			}), {
				status: 404,
				headers: { "Content-Type": "application/json" }
			});
		}

		// Parse the request body
		let requestData: {
			senderId?: string;
			ciphertext?: string;
			messageType?: string;
			nonce?: string;
			channelId?: string;
			ephemeral?: boolean;
			ttlSeconds?: number;
			mentionedUsers?: string[];
			username?: string;
			profile_pic?: string;
		};
		try {
			requestData = await request.json();
		} catch (error) {
			console.error("Failed to parse message request JSON:", error);
			return new Response(JSON.stringify({
				error: "Invalid JSON",
				message: "The request body could not be parsed as JSON"
			}), {
				status: 400,
				headers: { "Content-Type": "application/json" }
			});
		}

		const { senderId, ciphertext, messageType, nonce, mentionedUsers } = requestData;

		if (!senderId || !ciphertext) {
			return new Response(JSON.stringify({
				error: "Missing required fields",
				message: "Both sender and ciphertext are required"
			}), {
				status: 400,
				headers: { "Content-Type": "application/json" }
			});
		}

		// Verify sender is a channel participant
		if (!this.channel.participantIds.includes(senderId)) {
			console.log(`[handleSendMessage] Auto-adding sender ${senderId} to channel participants`);
			// Auto-add the user to participants instead of rejecting the request
			this.channel.participantIds.push(senderId);
			// Save the updated channel
			await this.ctx.storage.put("channel", this.channel);
			await this.ctx.storage.put(`channel:${this.channel.id}`, this.channel);
		}

		// Create the message
		const msgId = crypto.randomUUID();

		const message: DaturaMessage = {
			id: msgId,
			ciphertext,
			channelId: this.channel.id,
			senderId: senderId,
			timestamp: Date.now(),
			keyVersion: this.channel.keys.currentKeyVersion,
			messageType: messageType || 'Text',
			nonce,
			ephemeral: requestData.ephemeral || false,
			expiresAt: requestData.ephemeral ? Date.now() + (requestData.ttlSeconds || 86400) * 1000 : undefined,
			mentionedUsers: mentionedUsers || []
		};

		// Store and relay the message
		await this.storeAndRelayMessage(message);
		console.log(`Message ${msgId} sent by ${senderId} to channel ${this.channel.id}`);

		return new Response(JSON.stringify({
			success: true,
			messageId: msgId,
			timestamp: message.timestamp,
			channelId: this.channel.id
		}), {
			headers: { "Content-Type": "application/json" }
		});
	}

	/**
	 * Retrieve message history with pagination
	 */
	async handleGetMessageHistory(request: Request): Promise<Response> {
		if (!this.channel) {
			return new Response(JSON.stringify({ error: "Channel not initialized" }), {
				status: 500, headers: { "Content-Type": "application/json" }
			});
		}

		const channelId = this.channel.id;
		const url = new URL(request.url);
		const before = url.searchParams.get('before');
		const forceClear = url.searchParams.get('clear') === 'true';

		console.log(`[MESSAGING DEBUG] Fetching messages for channel ${channelId}, limit: ${100}, before: ${before || 'none'}, forceClear: ${forceClear}`);

		// OPTIONAL: Clear all messages for this channel if forceClear is true
		if (forceClear) {
			console.log(`[MESSAGING DEBUG] Force clearing all messages for channel ${channelId}`);
			const { error: clearError } = await this.supabase
				.from('messages')
				.delete()
				.eq('channel_id', channelId);

			if (clearError) {
				console.error(`[MESSAGING DEBUG] Error clearing messages: ${clearError.message}`);
			} else {
				console.log(`[MESSAGING DEBUG] Successfully cleared all messages for channel ${channelId}`);
			}

			return new Response(JSON.stringify({
				messages: [],
				cleared: true
			}), {
				headers: { "Content-Type": "application/json" }
			});
		}

		// Query Supabase for messages
		let query = this.supabase
			.from('messages')
			.select('*')
			.eq('channel_id', channelId)
			.order('created_at', { ascending: false })
			.limit(100);

		// Add timestamp filtering if 'before' is provided
		if (before) {
			query = query.lt('created_at', new Date(parseInt(before)).toISOString());
		}

		console.log(`[MESSAGING DEBUG] Executing Supabase query for messages`);
		const { data, error } = await query;

		if (error) {
			console.error('[MESSAGING DEBUG] Error fetching messages from Supabase:', error);
			return new Response(JSON.stringify({ error: "Failed to fetch messages" }), {
				status: 500, headers: { "Content-Type": "application/json" }
			});
		}

		console.log(`[MESSAGING DEBUG] Found ${data ? data.length : 0} messages from Supabase`);

		// Format messages for the client
		const messages = data ? data.map((msg: SupabaseMessage) => ({
			id: msg.id,
			channelId: msg.channelId,
			senderId: msg.senderId,
			ciphertext: msg.ciphertext,
			timestamp: new Date(msg.createdAt).getTime(),
			keyVersion: msg.keyVersion,
			ephemeral: msg.ephemeral,
			expiresAt: msg.expiresAt ? new Date(msg.expiresAt).getTime() : undefined,
			messageType: msg.messageType,
			nonce: msg.nonce
		})) : [];

		console.log(`[MESSAGING DEBUG] Returning ${messages.length} formatted messages to client`);

		return new Response(JSON.stringify({ messages }), {
			headers: { "Content-Type": "application/json" }
		});
	}

	/**
	 * Create an ephemeral message (disappearing message)
	 */
	async handleCreateEphemeralMessage(request: Request): Promise<Response> {
		if (!this.channel) {
			return new Response("Channel not found", { status: 404 });
		}

		const { senderId, ciphertext, ttlSeconds, messageType, nonce } = await request.json() as {
			senderId: string;
			ciphertext: string;
			ttlSeconds: number;
			messageType?: string;
			nonce?: string;
		};

		if (!senderId || !ciphertext || !ttlSeconds) {
			return new Response("Missing required fields", { status: 400 });
		}

		// Verify sender is a channel participant
		if (!this.channel.participantIds.includes(senderId)) {
			return new Response("Not a channel member", { status: 403 });
		}

		// Create the ephemeral message
		const msgId = crypto.randomUUID();

		const message: DaturaMessage = {
			id: msgId,
			ciphertext,
			channelId: this.channel.id,
			senderId: senderId,
			timestamp: Date.now(),
			keyVersion: this.channel.keys.currentKeyVersion,
			messageType: messageType || 'Text',
			nonce,
			ephemeral: true,
			expiresAt: Date.now() + ttlSeconds * 1000
		};

		// Store and relay the message
		await this.storeAndRelayMessage(message);

		return new Response(JSON.stringify({
			success: true,
			messageId: msgId,
			expiresAt: message.expiresAt
		}), {
			headers: { "Content-Type": "application/json" }
		});
	}

	/**
	 * Alarm handler for scheduled tasks
	 */
	async alarm(): Promise<void> {
		// We don't purge ephemeral messages from memory anymore
		// Instead, we use Supabase TTL or scheduled cleanup

		// For ephemeral messages, we should handle expiration in Supabase
		const now = new Date().toISOString();

		// Delete expired messages from Supabase
		const { error, count } = await this.supabase
			.from('messages')
			.delete({ count: 'exact' })
			.eq('channel_id', this.channel?.id)
			.eq('ephemeral', true)
			.lt('expires_at', now);

		if (error) {
			console.error('Error purging expired messages from Supabase:', error);
		} else if (count && count > 0) {
			console.log(`Purged ${count} expired ephemeral messages from Supabase`);

			// Notify clients about expired messages
			this.broadcastToSessions({
				type: "messages_expired",
				count,
				timestamp: Date.now()
			});
		}

		// Check if key rotation is needed
		await this.checkAndRotateKeys();

		// Reschedule alarm for tomorrow
		this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
	}

	/**
	 * Store a message and relay to connected clients
	 */
	private async storeAndRelayMessage(message: DaturaMessage): Promise<void> {
		console.log(`[storeAndRelayMessage] Started for message ${message.id}`);

		// Update channel stats (can keep in Durable Object or move to Supabase)
		if (this.channel) {
			this.channel.messageCount++;
			this.channel.lastActivity = Date.now();

			// Auto-add the senderId to participantIds if not already present
			if (!this.channel.participantIds.includes(message.senderId)) {
				console.log(`[storeAndRelayMessage] Auto-adding sender ${message.senderId} to channel participants`);
				this.channel.participantIds.push(message.senderId);
			}

			await this.ctx.storage.put("channel", this.channel);
			console.log(`[storeAndRelayMessage] Updated channel stats for ${this.channel.id}`);
		}

		// Prepare the message for Supabase insertion
		const messageToInsert = {
			id: message.id,
			createdAt: new Date(message.timestamp).toISOString(),
			channelId: message.channelId,
			senderId: message.senderId,
			ciphertext: message.ciphertext,
			messageType: message.messageType || 'Text',
			gardenId: this.channel?.gardenId || null,
			keyVersion: message.keyVersion,
			ephemeral: message.ephemeral || false,
			expiresAt: message.expiresAt ? new Date(message.expiresAt).toISOString() : null,
			nonce: message.nonce || '{}'
		};

		// Add debug logging for ciphertext
		console.log(`[DEBUG] Storing ciphertext length: ${message.ciphertext.length}`);
		console.log(`[DEBUG] Is valid Base64: ${/^[A-Za-z0-9+/=]+$/.test(message.ciphertext)}`);
		console.log(`[DEBUG] First 50 chars of ciphertext: ${message.ciphertext.substring(0, 50)}`);

		console.log(`[storeAndRelayMessage] Prepared Supabase message: ${JSON.stringify({
			id: messageToInsert.id,
			channelId: messageToInsert.channelId,
			messageType: messageToInsert.messageType,
			gardenId: messageToInsert.gardenId
		})}`);

		// Store the message in Supabase ONLY
		try {
			const { data, error } = await this.supabase
				.from('messages')
				.insert(messageToInsert)
				.select();

			if (error) {
				console.error('Error storing message in Supabase:', error);
				console.error('Error details:', JSON.stringify(error));
				console.error('Message that failed:', JSON.stringify(messageToInsert));
			} else {
				console.log(`Message ${message.id} stored in Supabase successfully:`, data);
			}
		} catch (err) {
			console.error('Exception during Supabase insert:', err);
			// Continue anyway to relay the message to connected clients
		}

		// Do NOT keep the message in memory or local storage
		// this.messages.set(message.id, message); <-- REMOVED

		// Relay to all connected sessions
		console.log(`[storeAndRelayMessage] Broadcasting message ${message.id} to ${this.sessions.size} connected sessions`);
		this.broadcastToSessions({
			type: "new_message",
			message
		});
	}

	/**
	 * Broadcast data to all connected WebSocket sessions
	 */
	private broadcastToSessions(data: any): void {
		const message = JSON.stringify(data);
		this.sessions.forEach(session => {
			try {
				session.send(message);
			} catch (err) {
				console.error("Error sending to WebSocket:", err);
			}
		});
	}

	/**
	 * Schedule the key rotation task
	 */
	private scheduleKeyRotation(): void {
		if (this.keyRotationTask !== null) {
			clearTimeout(this.keyRotationTask);
		}

		const nextRotation = this.calculateNextRotationTime();
		const delay = Math.max(0, nextRotation - Date.now());

		this.keyRotationTask = setTimeout(() => this.checkAndRotateKeys(), delay);
	}

	/**
	 * Calculate when the next key rotation should occur
	 */
	private calculateNextRotationTime(): number {
		if (!this.channel) return Date.now();

		const { keyRotationTimestamp, rotationPeriodHours } = this.channel.keys;
		return keyRotationTimestamp + rotationPeriodHours * 60 * 60 * 1000;
	}

	/**
	 * Check if key rotation is needed and perform it
	 */
	private async checkAndRotateKeys(): Promise<void> {
		if (!this.channel) return;

		const now = Date.now();
		const nextRotation = this.calculateNextRotationTime();

		if (now >= nextRotation) {
			// Generate new key material (in a real implementation, clients would submit new key material)
			const newPublicKeyMaterial = `auto-rotated-key-${Date.now()}`;

			// Perform key rotation
			await this.rotateKeys(newPublicKeyMaterial);

			// Reschedule next rotation
			this.scheduleKeyRotation();
		}
	}

	/**
	 * Perform key rotation with new key material
	 */
	private async rotateKeys(newPublicKeyMaterial: string): Promise<void> {
		if (!this.channel) return;

		const now = Date.now();
		const newKeyVersion = this.channel.keys.currentKeyVersion + 1;

		// Add new key generation
		this.channel.keys.keyGenerations.set(newKeyVersion, {
			createdAt: now,
			validUntil: now + this.channel.keys.rotationPeriodHours * 60 * 60 * 1000,
			publicKeyMaterial: newPublicKeyMaterial
		});

		// Update key metadata
		this.channel.keys.currentKeyVersion = newKeyVersion;
		this.channel.keys.keyRotationTimestamp = now;

		// Persist updated channel state
		await this.ctx.storage.put("channel", this.channel);

		// Notify all connected clients about key rotation
		this.broadcastToSessions({
			type: "key_rotated",
			channelId: this.channel.id,
			keyVersion: newKeyVersion,
			publicKeyMaterial: newPublicKeyMaterial,
			timestamp: now
		});

		console.log(`Rotated keys for channel ${this.channel.id} to version ${newKeyVersion}`);
	}

	/**
	 * Handle channel setup requests from the client app
	 */
	async handleSetupFromSupabase(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const pathParts = url.pathname.split('/').filter(p => p);
		let channelId = pathParts.length > 1 ? pathParts[1] : null;

		console.log(`Setup request received for channel: ${channelId || 'unknown'}`);

		try {
			// Parse the request body
			const setupData: ChannelSetupData = await request.json();

			// Extract the channel ID from the request data if not in URL
			if (!channelId && setupData.channelData && setupData.channelData.id) {
				channelId = setupData.channelData.id;
			} else if (!channelId && request.url.includes('channelId=')) {
				// Try to extract from query parameters
				channelId = url.searchParams.get('channelId');
			}

			if (!channelId) {
				return new Response(JSON.stringify({
					error: 'Missing channel ID',
					message: 'A channel ID is required for setup'
				}), {
					status: 400,
					headers: { 'Content-Type': 'application/json' }
				});
			}

			// Initialize channel if it doesn't exist yet
			if (!this.channel) {
				const now = Date.now();

				// Create key generation data
				const keyGeneration = new Map();
				keyGeneration.set(1, {
					createdAt: now,
					validUntil: now + (24 * 60 * 60 * 1000), // 24 hours
					publicKeyMaterial: setupData.keyData.public_key_material || 'initial-key-material'
				});

				// Create the channel state
				this.channel = {
					id: channelId,
					name: setupData.channelData?.name || `channel-${channelId.slice(0, 8)}`,
					keys: {
						channelId: channelId,
						currentKeyVersion: 1,
						keyRotationTimestamp: now,
						rotationPeriodHours: 24, // 24 hours by default
						keyGenerations: keyGeneration
					},
					participantIds: setupData.participants || [],
					createdAt: now,
					lastActivity: now,
					messageCount: 0
				};

				// Ensure the current user is in participants if provided
				const setupUserId = url.searchParams.get('userId');
				if (setupUserId && !this.channel.participantIds.includes(setupUserId)) {
					this.channel.participantIds.push(setupUserId);
				}

				// Store the channel state
				await this.ctx.storage.put("channel", this.channel);
				// Also store with the specific channel ID key
				await this.ctx.storage.put(`channel:${channelId}`, this.channel);

				// Schedule key rotation
				this.scheduleKeyRotation();

				console.log(`Created new channel: ${channelId} with ${this.channel.participantIds.length} participants`);
			} else {
				// Update existing channel with any new participants
				if (setupData.participants) {
					for (const participant of setupData.participants) {
						if (!this.channel.participantIds.includes(participant)) {
							this.channel.participantIds.push(participant);
						}
					}

					// Update the stored channel
					await this.ctx.storage.put("channel", this.channel);
					await this.ctx.storage.put(`channel:${channelId}`, this.channel);

					console.log(`Updated existing channel: ${channelId}, now has ${this.channel.participantIds.length} participants`);
				}
			}

			// Return success response
			return new Response(JSON.stringify({
				success: true,
				message: 'Channel setup completed successfully',
				channelId: this.channel.id,
				participantCount: this.channel.participantIds.length
			}), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		} catch (error) {
			console.error('Error in channel setup:', error);

			return new Response(JSON.stringify({
				error: 'Channel setup failed',
				message: error instanceof Error ? error.message : String(error),
				channelId
			}), {
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}
}

export default {
	/**
	 * Main fetch handler for Cloudflare Worker
	 */
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname.split('/').filter(Boolean);

		console.log(`Request received: ${request.method} ${url.pathname}`);

		// Handle root path
		if (url.pathname === '/' || path.length === 0) {
			return new Response("Datura E2EE Messaging API", {
				status: 200,
				headers: { "Content-Type": "text/plain" }
			});
		}

		// Handle routes based on first path segment
		switch (path[0]) {
			case 'channel': {
				// All channel routes require a channelId
				const channelId = path[1];
				if (!channelId) {
					return new Response(JSON.stringify({
						error: "Missing channel ID",
						message: "Channel ID is required in the path"
					}), {
						status: 400,
						headers: { "Content-Type": "application/json" }
					});
				}

				// Create a unique ID for this channel's Durable Object
				const doId = env.DATURA_CHANNELS.idFromName(channelId);
				const channelObj = env.DATURA_CHANNELS.get(doId);

				// If this is a WebSocket upgrade, forward directly
				const upgradeHeader = request.headers.get('Upgrade');
				if (upgradeHeader?.toLowerCase() === 'websocket') {
					return channelObj.fetch(request);
				}

				// Handle channel-specific subpaths
				if (path.length >= 3) {
					// Subpaths like /channel/{channelId}/messages/history
					if (path[2] === 'messages') {
						// Transform the request path to match internal structure
						// We'll modify the URL but keep the original request
						const newUrl = new URL(request.url);

						if (path[3] === 'history') {
							// Handle /channel/{channelId}/messages/history
							newUrl.pathname = '/messages/history';
							// Ensure channelId is in the query params for the DO
							newUrl.searchParams.set('channelId', channelId);

							const newRequest = new Request(newUrl, request);
							return channelObj.fetch(newRequest);
						} else if (path[3] === 'send') {
							// Handle /channel/{channelId}/messages/send
							newUrl.pathname = '/messages/send';
							newUrl.searchParams.set('channelId', channelId);

							const newRequest = new Request(newUrl, request);
							return channelObj.fetch(newRequest);
						}
					} else if (path[2] === 'setup') {
						// For setup requests, we forward as is
						return channelObj.fetch(request);
					} else if (path[2] === 'info') {
						// Handle /channel/{channelId}/info
						const newUrl = new URL(request.url);
						newUrl.pathname = '/channel/info';

						const newRequest = new Request(newUrl, request);
						return channelObj.fetch(newRequest);
					} else if (path[2] === 'rotate-keys') {
						// Handle /channel/{channelId}/rotate-keys
						const newUrl = new URL(request.url);
						newUrl.pathname = '/channel/rotate-keys';

						const newRequest = new Request(newUrl, request);
						return channelObj.fetch(newRequest);
					}
				}

				// For other channel requests, forward to the DO
				return channelObj.fetch(request);
			}

			case 'api': {
				// Handle API routes
				if (path[1] === 'create-channel') {
					// Generate a new channel ID
					const channelId = crypto.randomUUID();
					const doId = env.DATURA_CHANNELS.idFromName(channelId);
					const channelObj = env.DATURA_CHANNELS.get(doId);

					// Modify the request URL for channel creation
					const newUrl = new URL(request.url);
					newUrl.pathname = '/channel/create';

					// Add the generated channelId to the request
					const requestBody = await request.json();
					const modifiedBody = JSON.stringify({
						channelId,
						// Add other properties individually rather than using spread
						...(typeof requestBody === 'object' && requestBody !== null ? requestBody : {})
					});

					// Create a new request with the modified URL and body
					const newRequest = new Request(newUrl, {
						method: request.method,
						headers: request.headers,
						body: modifiedBody
					});

					return channelObj.fetch(newRequest);
				} else if (path[1] === 'health') {
					// Simple health check endpoint
					return new Response(JSON.stringify({
						status: "healthy",
						version: "1.0",
						timestamp: new Date().toISOString()
					}), {
						status: 200,
						headers: { "Content-Type": "application/json" }
					});
				}

				return new Response(JSON.stringify({
					error: "API endpoint not found",
					path: url.pathname
				}), {
					status: 404,
					headers: { "Content-Type": "application/json" }
				});
			}

			case 'messages': {
				// Legacy endpoints - redirect to new structure if possible
				const channelId = url.searchParams.get('channelId');

				if (!channelId) {
					return new Response(JSON.stringify({
						error: "Missing channel ID",
						message: "channelId query parameter is required"
					}), {
						status: 400,
						headers: { "Content-Type": "application/json" }
					});
				}

				// Get Durable Object for this channel
				const doId = env.DATURA_CHANNELS.idFromName(channelId);
				const channelObj = env.DATURA_CHANNELS.get(doId);

				// Forward the request to the Durable Object
				// The DO will handle message history/send endpoints
				return channelObj.fetch(request);
			}

			case 'websocket': {
				// Legacy WebSocket endpoint
				const channelId = url.searchParams.get('channelId');
				if (!channelId) {
					return new Response(JSON.stringify({
						error: "Missing channel ID",
						message: "channelId query parameter is required"
					}), {
						status: 400,
						headers: { "Content-Type": "application/json" }
					});
				}

				// Get Durable Object for this channel
				const doId = env.DATURA_CHANNELS.idFromName(channelId);
				const channelObj = env.DATURA_CHANNELS.get(doId);

				// Forward the WebSocket upgrade request to the DO
				return channelObj.fetch(request);
			}

			default:
				return new Response(JSON.stringify({
					error: "Not found",
					message: "The requested resource was not found",
					path: url.pathname
				}), {
					status: 404,
					headers: { "Content-Type": "application/json" }
				});
		}
	},
} satisfies ExportedHandler<Env>;
