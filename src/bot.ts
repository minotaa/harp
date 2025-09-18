import { 
	Client, 
	GatewayIntentBits, 
	Events, 
	SlashCommandBuilder, 
	Routes,
	REST,
	TextChannel,
	VoiceChannel,
	GuildMember,
	EmbedBuilder,
	type Interaction,
	ChatInputCommandInteraction
} from "discord.js";
import { Shoukaku, Connectors, LoadType, type Track, Player, ShoukakuEvents } from "shoukaku";
import Denque from "denque";

const Nodes = [
    {
        name: "Harp",
        url: `${process.env.LAVALINK_HOST}:${process.env.LAVALINK_PORT}`,
        auth: `${process.env.LAVALINK_PASSWORD}`,
    },
];

// Fixed: Better typing for queue structure
interface QueueData {
	queue: Denque<Track>;
	channel: string;
	currentTrack: Track | null;
	idleTimeout: NodeJS.Timeout | null;
}

const players: Map<string, Player> = new Map();
const queues: Map<string, QueueData> = new Map();

const client: Client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildVoiceStates,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent
	]
});
const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), Nodes);

shoukaku.on('ready', (_) => console.log(Bun.color("green", "ansi") + `✓`, Bun.color("white", "ansi") + (`Lavalink is ready!`)));
shoukaku.on('error', (_, error) => console.error(`Node ${_} error:`, error));
shoukaku.on('raw', (_, data) => {
	if ((data as any).op == "event") client.emit((data as any).type, data)
})

function sanitizeMessage(text: string) {
	return text
		.replace(/<@!?[0-9]+>/g, '') 
		.replace(/<@&[0-9]+>/g, '')
		.replace(/<#[0-9]+>/g, '')
		.replace(/@everyone/g, '')
		.replace(/@here/g, '');
}

// Fixed: Better track stuck event handling
client.on('TrackStuckEvent', async (data) => {
	const guildId = data.guildId;
	const player = players.get(guildId);
	const queueData = queues.get(guildId);

	console.log(Bun.color("red", "ansi") + `✖`, Bun.color("white", "ansi") + `Track stuck event in guild ${guildId}, attempting to skip...`);

	if (!player || !queueData) {
		console.log(Bun.color("red", "ansi") + `✖`, Bun.color("white", "ansi") + `No player or queue data found for stuck track in guild ${guildId}`);
		return;
	}

	const channel = await client.channels.fetch(queueData.channel) as TextChannel;
	await channel.send("`[✖]` The current track got jammed, skipping...");

	// Clear current track and play next
	queueData.currentTrack = null;
	console.log(Bun.color("yellow", "ansi") + `...`, Bun.color("white", "ansi") + `Clearing stuck track and attempting to play next in guild ${guildId}`);
	await playNext(guildId);
});

// Fixed: Proper track start handling
client.on('TrackStartEvent', async (data) => {
	const guildId = data.guildId;
	const queueData = queues.get(guildId);
	const player = players.get(guildId);
	
	if (!queueData || !player || !queueData.currentTrack) return;

	const track = queueData.currentTrack;
	const channel = await client.channels.fetch(queueData.channel) as TextChannel;

	console.log(
		Bun.color("green", "ansi") + `✓`,
		Bun.color("white", "ansi") + ` Now playing in ${guildId}: ${sanitizeMessage(track.info.title)} by ${sanitizeMessage(track.info.author)} (${queueData.queue.length} left)`
	);

	await channel.send(
		`[\`[✓]\`](${track.info.uri}) Now playing: **${sanitizeMessage(track.info.title)}** by **${sanitizeMessage(track.info.author)}** (${queueData.queue.length} left)`
	);
});

// Fixed: Improved track end handling
client.on('TrackEndEvent', async (data) => {
	const guildId = data.guildId;
	const queueData = queues.get(guildId);
	const player = players.get(guildId);
	
	console.log(Bun.color("blue", "ansi") + `♪`, Bun.color("white", "ansi") + `Track ended in guild ${guildId}, reason: ${data.reason}`);
	
	if (!queueData || !player) {
		console.log(Bun.color("red", "ansi") + `✖`, Bun.color("white", "ansi") + `No queue data or player found for guild ${guildId} after track end`);
		return;
	}

	// Clear current track
	queueData.currentTrack = null;
	console.log(Bun.color("yellow", "ansi") + `...`, Bun.color("white", "ansi") + `Cleared current track for guild ${guildId}, attempting to play next`);
	
	// Play next track
	await playNext(guildId);
});

// Fixed: New helper function for consistent queue management
async function playNext(guildId: string) {
	const queueData = queues.get(guildId);
	const player = players.get(guildId);
	
	console.log(Bun.color("blue", "ansi") + `♪`, Bun.color("white", "ansi") + `playNext() called for guild ${guildId}`);
	
	if (!queueData || !player) {
		console.log(Bun.color("red", "ansi") + `✖`, Bun.color("white", "ansi") + `playNext(): No queue data or player found for guild ${guildId}`);
		return;
	}

	// Clear any existing idle timeout since we're about to play something
	if (queueData.idleTimeout) {
		console.log(Bun.color("yellow", "ansi") + `...`, Bun.color("white", "ansi") + `Clearing existing idle timeout for guild ${guildId}`);
		clearTimeout(queueData.idleTimeout);
		queueData.idleTimeout = null;
	}

	const nextTrack = queueData.queue.shift();
	if (nextTrack) {
		queueData.currentTrack = nextTrack;
		// Store track metadata on player for reference
		(player as any).trackMetadata = nextTrack;
		console.log(Bun.color("blue", "ansi") + `♪`, Bun.color("white", "ansi") + `Playing next track: ${sanitizeMessage(nextTrack.info.title)} in guild ${guildId}`);
		await player.playTrack({ track: { encoded: nextTrack.encoded } });
	} else {
		queueData.currentTrack = null;
		(player as any).trackMetadata = null;
		const channel = await client.channels.fetch(queueData.channel) as TextChannel;
		console.log(Bun.color("yellow", "ansi") + `...`, Bun.color("white", "ansi") + ` Queue empty for guild ${guildId}, starting idle timeout.`);
		await channel.send(`\`[...]\` The queue has ended!`);

		// Set idle timeout for 2.5 minutes (150 seconds)
		queueData.idleTimeout = setTimeout(async () => {
			console.log(Bun.color("yellow", "ansi") + `...`, Bun.color("white", "ansi") + `Idle timeout reached for guild ${guildId}, leaving voice channel`);
			try {
				const idleChannel = await client.channels.fetch(queueData.channel) as TextChannel;
				await idleChannel.send(`\`[...]\` Left due to inactivity.`);
				
				// Clean up and leave
				await shoukaku.leaveVoiceChannel(guildId);
				players.delete(guildId);
				queues.delete(guildId);
				console.log(Bun.color("green", "ansi") + `✓`, Bun.color("white", "ansi") + `Successfully left voice channel due to inactivity in guild ${guildId}`);
			} catch (error) {
				console.log(Bun.color("red", "ansi") + `✖`, Bun.color("white", "ansi") + `Error during idle timeout cleanup in guild ${guildId}:`, error);
			}
		}, 150000); // 2.5 minutes
		console.log(Bun.color("yellow", "ansi") + `...`, Bun.color("white", "ansi") + `Set idle timeout (2.5 minutes) for guild ${guildId}`);
	}
}

// @ts-ignore
client.shoukaku = shoukaku;

client.once(Events.ClientReady, async client => {
	let commands = [
    new SlashCommandBuilder()
      .setName('play')
      .setDescription('Play a song from the provided link/query.')
      .addStringOption(query => 
        query
          .setName('query')
          .setDescription('Song query or link')
          .setRequired(true)  
      ).toJSON(),
		new SlashCommandBuilder()
			.setName('skip')
			.setDescription('Skips the currently playing song in the queue.')
			.addIntegerOption(option =>
				option
					.setName('amount')
					.setDescription('Number of songs to skip (default: 1)')
					.setRequired(false)
					.setMinValue(1)
			)
			.addIntegerOption(option =>
				option
					.setName('to')
					.setDescription('Skip to a specific position in the queue')
					.setRequired(false)
					.setMinValue(1)
			),
		new SlashCommandBuilder()
			.setName('stop')
			.setDescription('Stops playback and clears the queue.'),
		new SlashCommandBuilder()
			.setName('nowplaying')
			.setDescription('View the currently playing song.'),
		new SlashCommandBuilder()
			.setName('queue')
			.setDescription('View the current song queue.'),
		new SlashCommandBuilder()
			.setName('join')
			.setDescription('Join your voice channel.'),
		new SlashCommandBuilder()
			.setName('leave')
			.setDescription('Leave the voice channel and clear the queue.')
	]
	console.log(Bun.color("green", "ansi") + `✓`, Bun.color("white", "ansi") + (`Ready! Successfully logged in as ${client.user.tag}!`));
	console.log(Bun.color("yellow", "ansi") + "...", Bun.color("white", "ansi") + ("Attempting to send slash commands to Discord..."));
	try {
    const data = await rest.put(
			Routes.applicationCommands(process.env.CLIENT_ID as string),
			{ body: commands },
		); // @ts-ignore
    console.log(Bun.color("green", "ansi") + `✓`, Bun.color("white", "ansi") + (`Successfully reloaded ${data.length} application (/) commands.`));
  } catch (error) {
    console.error(error)
  }
});

const sendNowPlaying = async (interaction: ChatInputCommandInteraction, queueData: QueueData, track: Track) => {
	await interaction.editReply(`[\`[✓]\`](${track.info.uri}) Now playing: **${sanitizeMessage(track.info.title)}** by **${sanitizeMessage(track.info.author)}** (${queueData.queue.length} left)`);
};

const addToQueueMessage = async (interaction: ChatInputCommandInteraction, queueData: QueueData, track: Track, bulk = 1) => {
	if (bulk === 1) {
		await interaction.editReply(`[\`[✓]\`](${track.info.uri}) Added **${sanitizeMessage(track.info.title)}** by **${sanitizeMessage(track.info.author)}** to the queue. (${queueData.queue.length} left)`);
	} else {
		await interaction.editReply(`\`[✓]\` Added **${bulk}** tracks to the queue. (${queueData.queue.length} left)`);
	}
};

client.on(Events.InteractionCreate, async interaction => {
	if (!interaction.isChatInputCommand()) return;
	if (interaction.commandName.toLowerCase() === "play") {
		await interaction.deferReply();
		let query = interaction.options.getString('query')!;
		try { new URL(query); } catch {
			if (!query.startsWith("amsearch:") && !query.startsWith("ytsearch:") && !query.startsWith("spsearch:") && !query.startsWith("scsearch:")) {
				query = `ytsearch:${query}`;
			}
		}
		const node = shoukaku.getIdealNode();
		if (!node) return await interaction.editReply('`[...]\` No nodes available');
		console.log(Bun.color("yellow", "ansi") + "...", Bun.color("white", "ansi") + `Searching up: ${query}`);
		const result = await node.rest.resolve(query);

		if (!result || [LoadType.ERROR, LoadType.EMPTY].includes(result.loadType)) {
			console.log(Bun.color("yellow", "ansi") + "...", Bun.color("white", "ansi") + `Found no results for query: ${query}`);
			return await interaction.editReply('`[...]\` Found no results for your query.');
		}

		const member = interaction.member! as GuildMember;
		if (!member.voice.channel) {
			console.log(Bun.color("red", "ansi") + `✖`, Bun.color("white", "ansi") + `${member.displayName} (${member.id}) isn't in a voice channel, aborting.`);
			return await interaction.editReply('`[✖]` You\'re not in a voice channel.');
		}

		let player: Player;
		if (!players.has(interaction.guild!.id)) {
			console.log(Bun.color("blue", "ansi") + `♪`, Bun.color("white", "ansi") + `No existing player found, creating new connection to ${member.voice.channel!.name} (${member.voice.channel!.id}) in ${interaction.guild!.name}`);
			player = await shoukaku.joinVoiceChannel({
				guildId: interaction.guild!.id,
				channelId: member.voice.channel!.id,
				shardId: interaction.guild!.shardId,
			});
			players.set(interaction.guild!.id, player);
			console.log(Bun.color("green", "ansi") + `✓`, Bun.color("white", "ansi") + `Successfully connected to voice channel in ${interaction.guild!.name} (${interaction.guild!.id})`);
		} else {
			player = players.get(interaction.guild!.id)!;
			console.log(Bun.color("green", "ansi") + `✓`, Bun.color("white", "ansi") + `Using existing player connection in ${interaction.guild!.name} (${interaction.guild!.id})`);
		}

		let queueData: QueueData;
		if (!queues.has(interaction.guild!.id)) {
			queueData = { 
				queue: new Denque(), 
				channel: interaction.channel!.id,
				currentTrack: null,
				idleTimeout: null
			};
			queues.set(interaction.guild!.id, queueData);
			console.log(Bun.color("green", "ansi") + `✓`, Bun.color("white", "ansi") + `Making new queue for ${interaction.guild!.name} (${interaction.guild!.id}).`);
		} else {
			queueData = queues.get(interaction.guild!.id)!;
			console.log(Bun.color("green", "ansi") + `✓`, Bun.color("white", "ansi") + `Found previous queue for ${interaction.guild!.name} (${interaction.guild!.id}), using that.`);
		}

		// Fixed: Better handling of different load types
		switch (result.loadType) {
			case LoadType.PLAYLIST: {
				const tracks = result.data.tracks as Track[];
				console.log(Bun.color("green", "ansi") + `✓`, Bun.color("white", "ansi") + `Found playlist with ${tracks.length} tracks: ${result.data.info?.name || 'Unknown Playlist'}`);
				for (const track of tracks) {
					queueData.queue.push(track);
				}

				// If nothing is playing, start playing
				if (!queueData.currentTrack && !player.paused) {
					console.log(Bun.color("blue", "ansi") + `♪`, Bun.color("white", "ansi") + `No current track playing, starting first track from playlist in ${interaction.guild!.id}`);
					await playNext(interaction.guild!.id);
					await sendNowPlaying(interaction, queueData, tracks[0]);
				} else {
					console.log(Bun.color("yellow", "ansi") + `...`, Bun.color("white", "ansi") + `Added ${tracks.length} playlist tracks to existing queue in ${interaction.guild!.id}`);
					await addToQueueMessage(interaction, queueData, tracks[0], tracks.length);
				}
				break;
			}

			case LoadType.SEARCH: {
				const track = result.data[0] as Track;
				console.log(Bun.color("green", "ansi") + `✓`, Bun.color("white", "ansi") + `Found search result: ${sanitizeMessage(track.info.title)} by ${sanitizeMessage(track.info.author)}`);
				queueData.queue.push(track);

				// If nothing is playing, start playing
				if (!queueData.currentTrack && !player.paused) {
					console.log(Bun.color("blue", "ansi") + `♪`, Bun.color("white", "ansi") + `No current track playing, starting search result in ${interaction.guild!.id}`);
					await playNext(interaction.guild!.id);
					await sendNowPlaying(interaction, queueData, track);
				} else {
					console.log(Bun.color("yellow", "ansi") + `...`, Bun.color("white", "ansi") + `Added search result to existing queue in ${interaction.guild!.id}`);
					await addToQueueMessage(interaction, queueData, track);
				}
				break;
			}

			default: {
				const track = result.data as Track;
				console.log(Bun.color("green", "ansi") + `✓`, Bun.color("white", "ansi") + `Found direct track: ${sanitizeMessage(track.info.title)} by ${sanitizeMessage(track.info.author)}`);
				queueData.queue.push(track);

				// If nothing is playing, start playing
				if (!queueData.currentTrack && !player.paused) {
					console.log(Bun.color("blue", "ansi") + `♪`, Bun.color("white", "ansi") + `No current track playing, starting direct track in ${interaction.guild!.id}`);
					await playNext(interaction.guild!.id);
					await sendNowPlaying(interaction, queueData, track);
				} else {
					console.log(Bun.color("yellow", "ansi") + `...`, Bun.color("white", "ansi") + `Added direct track to existing queue in ${interaction.guild!.id}`);
					await addToQueueMessage(interaction, queueData, track);
				}
				break;
			}
		}
	}

	// Enhanced: Better skip command handling with amount and position options
	if (interaction.commandName.toLowerCase() === "skip") {
		const guildId = interaction.guild!.id;
		const player = players.get(guildId);
		const queueData = queues.get(guildId);
		const member = interaction.member! as GuildMember;
		const skipAmount = interaction.options.getInteger('amount');
		const skipTo = interaction.options.getInteger('to');

		console.log(Bun.color("blue", "ansi") + `♪`, Bun.color("white", "ansi") + `Skip command initiated by ${member.displayName} (${member.id}) in ${interaction.guild!.name} (amount: ${skipAmount}, to: ${skipTo})`);

		if (!member.voice.channel) {
			console.log(Bun.color("red", "ansi") + `✖`, Bun.color("white", "ansi") + `Skip failed: ${member.displayName} (${member.id}) not in voice channel`);
			return await interaction.reply('`[✖]` You\'re not in a voice channel.');
		}

		if (!player || !queueData?.currentTrack) {
			console.log(Bun.color("red", "ansi") + `✖`, Bun.color("white", "ansi") + `Skip failed: No player or current track in ${interaction.guild!.name}`);
			return await interaction.reply('`[✖]` Nothing is playing right now.');
		}

		// Handle skip to specific position
		if (skipTo !== null) {
			const totalTracks = queueData.queue.length + 1; // +1 for current track
			if (skipTo > totalTracks) {
				console.log(Bun.color("red", "ansi") + `✖`, Bun.color("white", "ansi") + `Skip to position failed: Position ${skipTo} exceeds queue size (${totalTracks}) in ${interaction.guild!.name}`);
				return await interaction.reply(`\`[✖]\` Position ${skipTo} doesn't exist. Queue has ${totalTracks} track(s) total.`);
			}

			if (skipTo === 1) {
				// Skip to position 1 is just the current track, so skip 0 from queue
				const skippedTrack = queueData.currentTrack;
				console.log(Bun.color("blue", "ansi") + `♪`, Bun.color("white", "ansi") + `Skipping to position 1 (current track): ${sanitizeMessage(skippedTrack.info.title)} in ${interaction.guild!.name}`);
				await interaction.reply('`[✓]` Already at position 1 (current track)!');
				return;
			}

			// Skip to position means we skip (position - 2) tracks from the queue
			// Position 2 = skip 0 from queue, Position 3 = skip 1 from queue, etc.
			const tracksToSkip = skipTo - 2;
			
			// Remove tracks from queue
			const skippedTracks = [];
			for (let i = 0; i < tracksToSkip && !queueData.queue.isEmpty(); i++) {
				const skipped = queueData.queue.shift();
				if (skipped) skippedTracks.push(skipped);
			}

			const skippedTrack = queueData.currentTrack;
			console.log(Bun.color("blue", "ansi") + `♪`, Bun.color("white", "ansi") + `Skipping to position ${skipTo}: Removed ${skippedTracks.length} tracks from queue in ${interaction.guild!.name}`);
			
			// Stop current track to play the target track
			player.stopTrack();
			await interaction.reply(`\`[✓]\` Skipped to position ${skipTo}, removed ${skippedTracks.length + 1} track(s).`);
			return;
		}

		// Handle skip by amount
		const amount = skipAmount || 1;
		const totalAvailable = queueData.queue.length + 1; // +1 for current track

		if (amount > totalAvailable) {
			console.log(Bun.color("red", "ansi") + `✖`, Bun.color("white", "ansi") + `Skip amount failed: Requested ${amount} exceeds available tracks (${totalAvailable}) in ${interaction.guild!.name}`);
			return await interaction.reply(`\`[✖]\` Cannot skip ${amount} track(s). Only ${totalAvailable} track(s) available.`);
		}

		if (amount === totalAvailable) {
			// Skipping all remaining tracks - clear everything
			const skippedTrack = queueData.currentTrack;
			queueData.queue.clear();
			queueData.currentTrack = null;
			console.log(Bun.color("blue", "ansi") + `♪`, Bun.color("white", "ansi") + `Skipping all ${amount} tracks, clearing queue in ${interaction.guild!.name}`);
			player.stopTrack();
			await interaction.reply(`\`[✓]\` Skipped all ${amount} track(s). Queue is now empty.`);
			return;
		}

		// Skip specific amount (but not all)
		const tracksToSkipFromQueue = amount - 1; // -1 because current track is included in amount
		const skippedTracks = [];
		
		// Remove tracks from queue
		for (let i = 0; i < tracksToSkipFromQueue && !queueData.queue.isEmpty(); i++) {
			const skipped = queueData.queue.shift();
			if (skipped) skippedTracks.push(skipped);
		}

		const skippedTrack = queueData.currentTrack;
		console.log(Bun.color("blue", "ansi") + `♪`, Bun.color("white", "ansi") + `Skipping ${amount} tracks (current + ${skippedTracks.length} from queue) in ${interaction.guild!.name}`);
		
		// Stop current track, which will trigger playing the next available track
		player.stopTrack();
		await interaction.reply(`\`[✓]\` Skipped ${amount} track(s).`);
	}

	// Fixed: Better stop command handling
	if (interaction.commandName.toLowerCase() === "stop") {
		const guildId = interaction.guild!.id;
		const player = players.get(guildId);
		const queueData = queues.get(guildId);
		const member = interaction.member! as GuildMember;

		console.log(Bun.color("blue", "ansi") + `♪`, Bun.color("white", "ansi") + `Stop command initiated by ${member.displayName} (${member.id}) in ${interaction.guild!.name}`);

		if (!member.voice.channel) {
			console.log(Bun.color("red", "ansi") + `✖`, Bun.color("white", "ansi") + `Stop failed: ${member.displayName} (${member.id}) not in voice channel`);
			return await interaction.reply('`[✖]` You\'re not in a voice channel.');
		}

		if (!player) {
			console.log(Bun.color("red", "ansi") + `✖`, Bun.color("white", "ansi") + `Stop failed: No player found in ${interaction.guild!.name}`);
			return await interaction.reply('`[✖]` Nothing is playing right now.');
		}

		// Clear queue and current track
		if (queueData) {
			const queueSize = queueData.queue.length + (queueData.currentTrack ? 1 : 0);
			
			// Clear any idle timeout
			if (queueData.idleTimeout) {
				console.log(Bun.color("yellow", "ansi") + `...`, Bun.color("white", "ansi") + `Clearing idle timeout during stop in ${interaction.guild!.name}`);
				clearTimeout(queueData.idleTimeout);
				queueData.idleTimeout = null;
			}
			
			queueData.queue.clear();
			queueData.currentTrack = null;
			console.log(Bun.color("yellow", "ansi") + `...`, Bun.color("white", "ansi") + `Cleared queue (${queueSize} tracks) and stopped playback in ${interaction.guild!.name}`);
		}
		(player as any).trackMetadata = null;
		player.stopTrack();

		await interaction.reply('`[✓]` Stopped playback and cleared the queue.');
	}

	// New: Join command
	if (interaction.commandName.toLowerCase() === "join") {
		const guildId = interaction.guild!.id;
		const existingPlayer = players.get(guildId);
		const member = interaction.member! as GuildMember;

		console.log(Bun.color("blue", "ansi") + `♪`, Bun.color("white", "ansi") + `Join command initiated by ${member.displayName} (${member.id}) in ${interaction.guild!.name}`);

		if (!member.voice.channel) {
			console.log(Bun.color("red", "ansi") + `✖`, Bun.color("white", "ansi") + `Join failed: ${member.displayName} (${member.id}) not in voice channel`);
			return await interaction.reply('`[✖]` You\'re not in a voice channel.');
		}

		// Check if already connected to a different voice channel
		if (existingPlayer && existingPlayer.voiceId !== member.voice.channel.id) {
			console.log(Bun.color("red", "ansi") + `✖`, Bun.color("white", "ansi") + `Join failed: Bot already connected to different voice channel (${existingPlayer.voiceId}) in ${interaction.guild!.name}`);
			return await interaction.reply('`[✖]` I\'m already connected to a different voice channel. Use `/leave` first if you want me to switch channels.');
		}

		// If already in the same channel
		if (existingPlayer && existingPlayer.voiceId === member.voice.channel.id) {
			console.log(Bun.color("yellow", "ansi") + `...`, Bun.color("white", "ansi") + `Already connected to ${member.voice.channel.name} (${member.voice.channel.id}) in ${interaction.guild!.name}`);
			return await interaction.reply('`[✓]` I\'m already connected to your voice channel!');
		}

		try {
			console.log(Bun.color("blue", "ansi") + `♪`, Bun.color("white", "ansi") + `Connecting to voice channel: ${member.voice.channel.name} (${member.voice.channel.id}) in ${interaction.guild!.name}`);
			const player = await shoukaku.joinVoiceChannel({
				guildId: interaction.guild!.id,
				channelId: member.voice.channel.id,
				shardId: interaction.guild!.shardId,
			});
			players.set(interaction.guild!.id, player);
			console.log(Bun.color("green", "ansi") + `✓`, Bun.color("white", "ansi") + `Successfully joined voice channel: ${member.voice.channel.name} in ${interaction.guild!.name}`);
			await interaction.reply(`\`[✓]\` Joined **${member.voice.channel.name}**!`);
		} catch (error) {
			console.log(Bun.color("red", "ansi") + `✖`, Bun.color("white", "ansi") + `Failed to join voice channel in ${interaction.guild!.name}:`, error);
			await interaction.reply('`[✖]` Failed to join the voice channel. Please try again.');
		}
	}

	// New: Leave command
	if (interaction.commandName.toLowerCase() === "leave") {
		const guildId = interaction.guild!.id;
		const player = players.get(guildId);
		const queueData = queues.get(guildId);
		const member = interaction.member! as GuildMember;

		console.log(Bun.color("blue", "ansi") + `♪`, Bun.color("white", "ansi") + `Leave command initiated by ${member.displayName} (${member.id}) in ${interaction.guild!.name}`);

		if (!player) {
			console.log(Bun.color("red", "ansi") + `✖`, Bun.color("white", "ansi") + `Leave failed: Not connected to any voice channel in ${interaction.guild!.name}`);
			return await interaction.reply('`[✖]` I\'m not connected to a voice channel.');
		}

		try {
			// Clear queue and stop playback
			if (queueData) {
				const queueSize = queueData.queue.length + (queueData.currentTrack ? 1 : 0);
				
				// Clear any idle timeout
				if (queueData.idleTimeout) {
					console.log(Bun.color("yellow", "ansi") + `...`, Bun.color("white", "ansi") + `Clearing idle timeout during leave in ${interaction.guild!.name}`);
					clearTimeout(queueData.idleTimeout);
					queueData.idleTimeout = null;
				}
				
				queueData.queue.clear();
				queueData.currentTrack = null;
				console.log(Bun.color("yellow", "ansi") + `...`, Bun.color("white", "ansi") + `Cleared queue (${queueSize} tracks) during leave in ${interaction.guild!.name}`);
				queues.delete(guildId);
			}

			// Stop player and disconnect
			(player as any).trackMetadata = null;
			player.stopTrack();
			
			const channelName = player.voiceId ? `<#${player.voiceId}>` : 'voice channel';
			console.log(Bun.color("blue", "ansi") + `♪`, Bun.color("white", "ansi") + `Disconnecting from voice channel (${player.voiceId}) in ${interaction.guild!.name}`);
			
			await shoukaku.leaveVoiceChannel(guildId);
			players.delete(guildId);
			
			console.log(Bun.color("green", "ansi") + `✓`, Bun.color("white", "ansi") + `Successfully left voice channel in ${interaction.guild!.name}`);
			await interaction.reply(`\`[✓]\` Left ${channelName} and cleared the queue!`);
		} catch (error) {
			console.log(Bun.color("red", "ansi") + `✖`, Bun.color("white", "ansi") + `Error during leave command in ${interaction.guild!.name}:`, error);
			await interaction.reply('`[✖]` An error occurred while leaving the voice channel.');
		}
	}

	// Fixed: Better nowplaying command
	if (interaction.commandName.toLowerCase() === "nowplaying") {
		const guildId = interaction.guild!.id;
		const player = players.get(guildId);
		const queueData = queues.get(guildId);

		if (!queueData?.currentTrack) {
			return await interaction.reply('`[✖]` Nothing is playing right now.');
		}

		const track = queueData.currentTrack;
		const totalLeft = queueData.queue.length;

		await interaction.reply(
			`[\`[✓]\`](${track.info.uri}) Now playing: **${sanitizeMessage(track.info.title)}** by **${sanitizeMessage(track.info.author)}** (${totalLeft} left)`
		);
	}

	// Fixed: Better queue display
	if (interaction.commandName.toLowerCase() === "queue") {
		const guildId = interaction.guild!.id;
		const player = players.get(guildId);
		const queueData = queues.get(guildId);

		if (!queueData || (!queueData.currentTrack && queueData.queue.isEmpty())) {
			return await interaction.reply("`[✖]` The queue is currently empty.");
		}

		const lines: string[] = [];
		
		// Show currently playing track
		if (queueData.currentTrack) {
			const current = queueData.currentTrack;
			lines.push(`**Now Playing:** [**${sanitizeMessage(current.info.title)}**](${current.info.uri}) by **${sanitizeMessage(current.info.author)}**`);
		}

		// Show upcoming tracks
		if (!queueData.queue.isEmpty()) {
			lines.push("\n**Up Next:**");
			const tracks = queueData.queue.toArray();
			tracks.slice(0, 10).forEach((track, index) => {
				lines.push(`${index + 1}. [**${sanitizeMessage(track.info.title)}**](${track.info.uri}) by **${sanitizeMessage(track.info.author)}**`);
			});
			
			if (tracks.length > 10) {
				lines.push(`*...and ${tracks.length - 10} more tracks*`);
			}
		}

		await interaction.reply(lines.join("\n"));
	}
})

const rest = new REST();
rest.setToken(process.env.TOKEN);

client.login(process.env.TOKEN);