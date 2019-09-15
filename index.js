const Discord = require('discord.js')
const client = new Discord.Client()
const config = require('./config.json')
const db = require('better-sqlite3')('register.db', {verbose: console.log})
const registry = {}
const available = []
const convos = {}

client.on('ready', () => {
	client.user.setActivity("Talking to Strangers");
	const table = db.prepare("SELECT count(*) FROM sqlite_master WHERE type='table' AND name = 'profile';").get();
	if (!table['count(*)']) {
		db.prepare("CREATE TABLE profile (user_id TEXT NOT NULL PRIMARY KEY UNIQUE, user_name TEXT NOT NULL, user_desc TEXT, available BOOLEAN DEFAULT false, stranger_id TEXT);").run();
		db.prepare("CREATE UNIQUE INDEX user_profile_id ON profile (user_id);").run();
		db.pragma("synchronous = 1");
		db.pragma("journal_mode = wal");
	}
	console.log('Running...')
})

client.on('message', message => {
	const user = message.author
	if(user.bot)
		return
	if(message.content.startsWith(config.prefix)) {
		const command = message.content.split(' ')[0].substring(config.prefix.length)
		console.log(command, ' received from ', user.username)
		let check = false
		switch(command) {
			case 'register':
				check = db.prepare('SELECT user_id FROM profile WHERE user_id = ?').get(user.id)
				if(check)
					return
				db.prepare('INSERT INTO profile (user_id, user_name, user_desc) VALUES (?, ?, ?)').run(user.id, user.username, 'Just a random person.')
				message.channel.send(":white_check_mark: You are now Registered " +  "<@" + message.author.id + ">")

				return
				break
			case 'unregister':
				check = db.prepare('SELECT user_id FROM profile WHERE user_id = ?').get(user.id)
				if(!check)
					return
				let stranger = db.prepare('SELECT stranger_id FROM profile WHERE user_id = ?').get(user.id)
				if(stranger && stranger.stranger_id) {
					db.prepare('UPDATE profile SET stranger_id = ? WHERE user_id = ?').run('', stranger.stranger_id)
					client.users.get(stranger.stranger_id).send('Stranger left the conversation...')
				}
				db.prepare('DELETE FROM profile WHERE user_id = ?').run(user.id)
				message.channel.send(':x: Account Deleted!')
				delete registry[user.id]
				return
				break
			case 'available':
				doAvailable(message, user)
				return
				break
			case 'unavailable':
				check = db.prepare('SELECT available FROM profile WHERE user_id = ?').get(user.id)
				if(check && check.available) {
					db.prepare('UPDATE profile SET available = false WHERE user_id = ?').run(user.id)
					message.channel.send('Availability turned off!')
				}
				return
				break
			case 'leave':
				doLeave(message, user)
				return
				break
			case 'strangers':
				const row = db.prepare('SELECT COUNT(*) FROM profile WHERE available = true').get()
				const i = row['COUNT(*)']
				message.channel.send(`There ${i != 1 ? 'are' : 'is'} ${i} user${i != 1 ? 's' : ''} available now.`)
				return
				break
			case 'status':
				const embed = {}
				check = db.prepare('SELECT available FROM profile WHERE user_id = ?').get(user.id)
				if(!check)
					return
				const avail = check.available
				embed.color = avail ? 0x26E388 : 0xE72929
				embed.author = {}
				embed.author.name = user.username
				embed.author.icon_url = avail ? 'https://www.iconsdb.com/icons/preview/color/26E388/circle-xxl.png' : 'https://www.iconsdb.com/icons/preview/color/E72929/circle-xxl.png'
				embed.title = 'Status: ' + (avail ? 'available' : 'unavailable')
				message.channel.send('', {embed: embed})
				return
				break
			case 'next':
				check = db.prepare('SELECT available, stranger_id FROM profile WHERE user_id = ?').get(user.id)
				if(!check)
					return
				if(check.stranger_id)
					doLeave(message, user)
				doAvailable(message, user)
				return
				break
			case 'help':
				doHelp(message, user)
				return
				break
			default:
				break
		}
	}
	let stranger = db.prepare('SELECT stranger_id FROM profile WHERE user_id = ?').get(user.id)
	if(message.channel.type === 'dm' && stranger && stranger.stranger_id)
		client.users.get(stranger.stranger_id).send(message.content)
})

function doLeave(message, user) {
	let check = db.prepare('SELECT stranger_id FROM profile WHERE user_id = ?').get(user.id)
	if(check && check.stranger_id) {
		db.prepare('UPDATE profile SET stranger_id = ? WHERE user_id IN (?, ?)').run('', user.id, check.stranger_id)
		message.channel.send('Left conversation...')
		client.users.get(check.stranger_id).send('Stranger has left the conversation...')
	}
}

function doAvailable(message, user) {
	let check = db.prepare('SELECT available, stranger_id FROM profile WHERE user_id = ?').get(user.id)
	if(!check || check.available || check.stranger_id)
		return
	check = db.prepare('SELECT user_id FROM profile WHERE available = true').all()
	if(check) {
		let stranger = ''
		for(let i of check) {
			const r = Math.floor(Math.random() * check.length)
			stranger = check[r].user_id
			let avail = db.prepare('SELECT available FROM profile WHERE user_id = ?').get(user.id)
			if(!avail)
				continue
			db.prepare('UPDATE profile SET available = false, stranger_id = ? WHERE user_id = ?').run(stranger, user.id)
			db.prepare('UPDATE profile SET available = false, stranger_id = ? WHERE user_id = ?').run(user.id, stranger)
			message.author.send('Matched with a stranger, have a nice chat!')
			client.users.get(stranger).send('Matched with a stranger!')
			return
		}
	}
	db.prepare('UPDATE profile SET available = true WHERE user_id = ?').run(user.id)
	message.channel.send('Availability turned on!')
	return
}

	function doHelp(message, user) {
	const helpEmbed = new Discord.RichEmbed()
	.setColor('#4D70EF')
	.setTitle('List of commands')
	.addField('**Registration**', '**register** - Register an account \n**unregister** - Unregister / Delete your current account')
	.addField('**Status**', '\n**status** - Check your current availability status \n**strangers** - Shows how many strangers are currently available in queue')
	.addField('**Matching**', '**available** - Changes your status to Available (Adds you in queue for matchmaking) \n**unavailable** - Changes your status to Unavailable (Unqueue you from the matchmaking) \n**next** - Leaves the current conversation and matches you with another stranger \n**leave** - Leave the current conversation (automatically unqueues you)')
	message.channel.send(helpEmbed);
	}

	// function doRegister(message, user) {
	// const registerEmbed = new Discord.RichEmbed()
	// .setColor('#4D70EF')
	
	// message.channel.send(registerEmbed);
	// }

client.login(config.token)