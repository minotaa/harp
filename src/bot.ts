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
import { Shoukaku, Connectors, LoadType, type Track } from "shoukaku";

const Nodes = [
    {
        name: "Harp",
        url: `${process.env.LAVALINK_HOST}:${process.env.LAVALINK_PORT}`,
        auth: `${process.env.LAVALINK_PASSWORD}`,
    },
];

const client: Client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildVoiceStates,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent
	]
});
const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), Nodes);

shoukaku.on('ready', (name) => console.log(Bun.color("green", "ansi") + `✓`, Bun.color("white", "ansi") + (`Lavalink is ready!`)));
shoukaku.on('error', (name, error) => console.error(`Node ${name} error:`, error));
client.shoukaku = shoukaku;

client.once(Events.ClientReady, async client => {
	let commands = [
    new SlashCommandBuilder()
      .setName('play')
      .setDescription('Play a song from the provided link/query.')
      .addStringOption(query => 
        query
          .setName('query')
          .setDescription('User to view leveling rank')
          .setRequired(true)  
      ).toJSON(),
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
	if (interaction.commandName.toLowerCase() == "play") {
		let query = interaction.options.getString('query')!;
		try {
			new URL(query);
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
		} catch (_: unknown) {
			query = `ytsearch:${query}`;
		}	
		await interaction.deferReply();
		const node = shoukaku.getIdealNode();
		if (!node) throw new Error('No nodes available');
		const result = await node.rest.resolve(query);
		if (!result || [ LoadType.ERROR, LoadType.EMPTY ].includes(result.loadType)) return await interaction.editReply('Unfortunately, there are no results for your query');
		const member = interaction.member! as GuildMember;
		let player = await shoukaku.joinVoiceChannel({
			guildId: interaction.guild!.id,
			channelId: member.voice.channel!.id,
			shardId: interaction.guild!.shardId,
		});

		let track: Track;
		
		switch (result.loadType) {
			case LoadType.PLAYLIST:
				console.log("Future logic for queue to be added here.");
			case LoadType.SEARCH: // @ts-ignore
				track = result.data[0];
				player!.playTrack({ track: { encoded: track.encoded }});
				let embed = new EmbedBuilder();
					embed.setTitle(`Now Playing: ${track.info.title}`);
					embed.setURL(`${track.info.uri}`);
					embed.setImage(`${track.info.artworkUrl}`);
				await interaction.editReply({ embeds: [embed] });
			default:
				track = result.data as Track;
				player!.playTrack({ track: { encoded: track.encoded }});
		}
	}
})

const rest = new REST();
rest.setToken(process.env.TOKEN);

client.login(process.env.TOKEN);