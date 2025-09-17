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
	EmbedBuilder
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

const players: Map<String, Player> = new Map();
const queues: Map<String, Object> = new Map();

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


client.on('TrackStartEvent', async (data) => {
	const guildId = data.guildId;
	const queue = queues.get(guildId) as any;
	const player = players.get(guildId);
	if (!queue || !player || !player.trackMetadata) return;

	const track = player.trackMetadata;
	const channel = await client.channels.fetch(queue.channel) as TextChannel;

	console.log(
		Bun.color("green", "ansi") + `✓`,
		Bun.color("white", "ansi") + ` Now playing in ${guildId}: ${sanitizeMessage(track.info.title)} by ${sanitizeMessage(track.info.author)} (${queue.queue.length + 1} left)`
	);

	await channel.send(
		`[\`[✓]\`](${track.info.uri}) Now playing: **${sanitizeMessage(track.info.title)}** by **${sanitizeMessage(track.info.author)}** (${queue.queue.length + 1} left)`
	);
});


client.on('TrackEndEvent', async (data) => {
	const guildId = data.guildId;
	const queue = queues.get(guildId) as any;
	if (!queue) return;

	const next = queue.queue.shift();
	if (next) {
		const player = players.get(guildId);
		if (player) {
			player.trackMetadata = next;
			await player.playTrack({ track: { encoded: next.encoded } });
		}
	} else {
		const channel = await client.channels.fetch(queue.channel) as TextChannel;
		console.log(Bun.color("yellow", "ansi") + `...`, Bun.color("white", "ansi") + ` Queue empty for guild ${guildId}.`);
		await channel.send(`\`[...]\` The queue has ended!`);
	}
});



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

client.on(Events.InteractionCreate, async interaction => {
	if (!interaction.isChatInputCommand()) return;
	if (interaction.commandName.toLowerCase() === "play") {
		let query = interaction.options.getString('query')!;
		try { new URL(query); } catch {
			if (!query.startsWith("amsearch:") && !query.startsWith("ytsearch:") && !query.startsWith("spsearch:") && !query.startsWith("scsearch:")) {
				query = `ytsearch:${query}`;
			}
		}

		await interaction.deferReply();
		const node = shoukaku.getIdealNode();
		if (!node) throw new Error('No nodes available');
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
			player = await shoukaku.joinVoiceChannel({
				guildId: interaction.guild!.id,
				channelId: member.voice.channel!.id,
				shardId: interaction.guild!.shardId,
			});
			players.set(interaction.guild!.id, player);
		} else {
			player = players.get(interaction.guild!.id)!;
		}

		let queue: { queue: Denque<Track>, channel: string };
		if (!queues.has(interaction.guild!.id)) {
			queue = { queue: new Denque(), channel: interaction.channel!.id };
			queues.set(interaction.guild!.id, queue);
			console.log(Bun.color("green", "ansi") + `✓`, Bun.color("white", "ansi") + `Making new queue for ${interaction.guild!.name} (${interaction.guild!.id}).`);
		} else {
			queue = queues.get(interaction.guild!.id)! as any;
			console.log(Bun.color("green", "ansi") + `✓`, Bun.color("white", "ansi") + `Found previous queue for ${interaction.guild!.name} (${interaction.guild!.id}), using that.`);
		}

		const sendNowPlaying = async (track: Track) => {
			await interaction.editReply(`[\`[✓]\`](${track.info.uri}) Now playing: **${sanitizeMessage(track.info.title)}** by **${sanitizeMessage(track.info.author)}** (${queue.queue.length + 1} left)`);
		};

		const addToQueueMessage = async (track: Track, bulk = 1) => {
			if (bulk === 1) {
				await interaction.editReply(`[\`[✓]\`](${track.info.uri}) Added **${sanitizeMessage(track.info.title)}** by **${sanitizeMessage(track.info.author)}** to the queue. (${queue.queue.length + 1} left)`);
			} else {
				await interaction.editReply(`\`[✓]\` Added **${bulk}** tracks to the queue. (${queue.queue.length + 1} left)`);
			}
		};

		switch (result.loadType) {
			case LoadType.PLAYLIST: {
				const tracks = result.data.tracks as any;
				for (const t of tracks) queue.queue.push(t);

				if (!player.track && !player.paused && queue.queue.length > 0) {
					const next = queue.queue.shift()!;
					player.playTrack({ track: { encoded: next.encoded } });
					await sendNowPlaying(next);
				} else {
					await addToQueueMessage(tracks[0], tracks.length);
				}
				break;
			}

			case LoadType.SEARCH: {
				const track = result.data[0] as Track;
				queue.queue.push(track);

				if (!player.track && !player.paused && queue.queue.length > 0) {
					const next = queue.queue.shift()!;
					player.playTrack({ track: { encoded: next.encoded } });
					await sendNowPlaying(next);
				} else {
					await addToQueueMessage(track);
				}
				break;
			}

			default: {
				const track = result.data as Track;
				queue.queue.push(track);

				if (!player.track && !player.paused && queue.queue.length > 0) {
					const next = queue.queue.shift()!;
					player.playTrack({ track: { encoded: next.encoded } });
					await sendNowPlaying(next);
				} else {
					await addToQueueMessage(track);
				}
				break;
			}
		}
	}

	if (interaction.commandName.toLowerCase() === "skip") {
		const guildId = interaction.guild!.id;
		const player = players.get(guildId);
		const queue = queues.get(guildId) as any;
		const member = interaction.member! as GuildMember;

		if (!member.voice.channel) {
			return await interaction.editReply('`[✖]` You\'re not in a voice channel.');
		}

		if (!player || !player.track) {
			return await interaction.reply('`[✖]` Nothing is playing right now.');
		}

		const next = queue.queue.shift();
		if (next) {
			player.trackMetadata = next;
			await player.playTrack({ track: { encoded: next.encoded } });

			await interaction.reply(
				`[\`[✓]\`](${next.info.uri}) Skipped the current track to: **${sanitizeMessage(next.info.title)}** by **${sanitizeMessage(next.info.author)}**`
			);
		} else {
			player.stopTrack();
			await interaction.reply('`[...]\` Skipped the current track. The queue is now empty.');
		}
}

})

const rest = new REST();
rest.setToken(process.env.TOKEN);

client.login(process.env.TOKEN);