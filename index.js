const Discord = require('discord.js')
const client = new Discord.Client()
const config = require('./config.json')
const db = require('better-sqlite3')('register.db', {verbose: console.log})
const registry = {}
const available = []
const convos = {}
const sql_arr_sep = ', '
const stranger_history_limit = 25

client.on('ready', () => {
	client.user.setActivity("with Strangers")
	const table = db.prepare("SELECT count(*) FROM sqlite_master WHERE type='table' AND name = 'profile';").get();
	if (!table['count(*)']) {
		db.prepare("CREATE TABLE profile (user_id TEXT NOT NULL PRIMARY KEY UNIQUE, user_name TEXT NOT NULL, user_desc TEXT, available BOOLEAN DEFAULT false, stranger_id TEXT, past_strangers TEXT NOT NULL DEFAULT '', blocked_strangers TEXT NOT NULL DEFAULT '', stranger_ts TEXT NOT NULL DEFAULT '');").run();
		db.prepare("CREATE UNIQUE INDEX user_profile_id ON profile (user_id);").run();
		db.pragma("synchronous = 1");
		db.pragma("journal_mode = wal");
	}
	db.prepare("CREATE TABLE IF NOT EXISTS blacklist (user_id TEXT NOT NULL PRIMARY KEY UNIQUE, reason TEXT NOT NULL, ts TEXT NOT NULL);").run()
	db.prepare("CREATE TABLE IF NOT EXISTS reports (user_id TEXT NOT NULL, reason TEXT NOT NULL, ts TEXT NOT NULL, stranger_id TEXT NOT NULL);").run()
	db.prepare("CREATE TABLE IF NOT EXISTS devs (user_id TEXT NOT NULL PRIMARY KEY UNIQUE)").run()
	console.log(client.user.username + ' running...')
})

client.on('message', message => {
	const user = message.author
	if(user.bot)
		return
	if(message.content.startsWith(config.prefix)) {
		const split_msg = message.content.split(' '),
			command = split_msg.shift().substring(config.prefix.length),
			args = split_msg
		console.log(command, ' received from ', user.username, ' with args: ', args)
		let check = db.prepare('SELECT 1 FROM blacklist WHERE user_id = ?').get(user.id)
		if(check)
			return
		else
			check = false	
		switch(command) {
			case 'register':
				check = db.prepare('SELECT user_id FROM profile WHERE user_id = ?').get(user.id)
				if(check)
					return message.channel.send(user + ', you are already registered!')
				db.prepare('INSERT INTO profile (user_id, user_name, user_desc) VALUES (?, ?, ?)').run(user.id, user.username, 'Just a random person.')
				message.channel.send('Registered!')
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
				message.channel.send('Unregistered...')
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
				if(check && !check.available)
					return message.channel.send(user + ', your status is already Unavailable!')
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
				check = db.prepare('SELECT available, stranger_id FROM profile WHERE user_id = ?').get(user.id)
				if(!check)
					return message.channel.send('Unregistered!')
				const avail = check.available
				embed.color = avail ? 0x26E388 : 0xE72929
				embed.author = {}
				embed.author.name = user.username
				embed.author.icon_url = avail ? 'https://www.iconsdb.com/icons/preview/color/26E388/circle-xxl.png' : 'https://www.iconsdb.com/icons/preview/color/E72929/circle-xxl.png'
				embed.description = 'Status: ' + (avail ? 'available' : 'unavailable') + ' and ' + (check.stranger_id ? 'currently matched with a stranger.' : 'not matched with any stranger.')
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
			case 'block':
				check = db.prepare('SELECT blocked_strangers, stranger_id, past_strangers FROM profile WHERE user_id = ?').get(user.id)
				let blocks = check.blocked_strangers.split(sql_arr_sep).filter(Boolean),
					[target, wording] = getBlockTarget(check, args, check.past_strangers.split(sql_arr_sep).filter(Boolean))
				if(!target)
					return message.channel.send('Invalid command!')
				if(blocks.includes(target))
					return message.channel.send('Stranger already blocked!')
				blocks = [target].concat(blocks).join(sql_arr_sep)
				db.prepare('UPDATE profile SET blocked_strangers = ? WHERE user_id = ?').run(blocks, user.id)
				doLeave(message, user)
				message.channel.send(user + ', ' + wording + ' blocked!')
				return
				break
			case 'unblock':
				check = db.prepare('SELECT blocked_strangers, stranger_id, past_strangers FROM profile WHERE user_id = ?').get(user.id)
				let ublocks = check.blocked_strangers.split(sql_arr_sep).filter(Boolean),
					[utarget, uwording] = getBlockTarget(check, args, ublocks)
				if(args.length == 0)
					return message.channel.send(user + ', you have ' + (ublocks[0] ? ublocks.length : 0) + ' blocked stranger' + (ublocks.length == 1 && ublocks[0] ? '' : 's') + '!')
				if(!ublocks)
					return message.channel.send(user + ', you have no blocked strangers!')
				if(!utarget)
					return message.channel.send('Invalid command!')
				if(!ublocks.includes(utarget))
					return message.channel.send('Stranger is not in the block list!')
				ublocks = ublocks.filter(x => x != utarget).join(sql_arr_sep)
				db.prepare('UPDATE profile SET blocked_strangers = ? WHERE user_id = ?').run(ublocks, user.id)
				message.channel.send(user + ', ' + uwording + ' unblocked!')
				return
				break
			case 'report':
				const reason = args.join(' '),
					proof = message.attachments.size ? {files: message.attachments.map(x => x.url)} : {}
				check = db.prepare('SELECT stranger_id, past_strangers FROM profile WHERE user_id = ?').get(user.id)
				rstranger = check.stranger_id || past_strangers[0]
				if(!reason)
					return message.channel.send(user + ', you need to provide a reason!')
				if(!rstranger)
					return message.channel.send(user + ', no one to report...')
				db.prepare('INSERT INTO reports (user_id, reason, ts, stranger_id) VALUES (?, ?, DATETIME("now", "localtime"), ?)').run(user.id, reason, rstranger)
				check = db.prepare('SELECT user_id FROM devs').all()
				for(const dev of check) {
					client.users.get(dev.user_id).send(user + ' (' + user.id + ') reported ' + client.users.get(rstranger) + ' (' + rstranger + ') for:\n' + reason, proof)
				}
				return
				break
			case 'blacklist':
				check = db.prepare('SELECT 1 FROM devs WHERE user_id = ?').get(user.id)
				if(!check)
					return
				let btarget = message.mentions.users.first() || args[0],
					breason = btarget == args[0] ? args.slice(1).join(' ') : args.join(' ')
				if(!btarget)
					return message.channel.send('Invalid command!')
				if(!breason)
					return message.channel.send('Please provide a reason!')
				db.prepare('INSERT INTO blacklist (user_id, reason, ts) VALUES (?, ?, DATETIME("now", "localtime"))').run(btarget, breason)
				db.prepare('DELETE FROM profile WHERE user_id = ?').run(btarget)
				check = db.prepare('SELECT user_id FROM profile WHERE stranger_id = ?').get(btarget)
				if(check)
					db.prepare('UPDATE profile SET stranger_id = "" WHERE user_id = ?').run(check.user_id)
				message.channel.send(user + ', user blacklisted and unregistered!')
				return
				break
			case 'time':
				check = db.prepare('SELECT stranger_ts FROM profile WHERE user_id = ?').get(user.id)
				if(!check.stranger_ts)
					return message.channel.send(user + ', you are not paired up with a stranger...')
				const time = Math.floor(new Date(new Date() - new Date(check.stranger_ts)).getTime() / 1000),
					hours = Math.floor(time / 3600),
					mins = Math.floor(time / 60) % 60
				message.channel.send(user + ', you have been paired with this stranger for: ' + (!hours ? '' : hours + ' hour' + (hours == 1 ? '' : 's') + ' and ') + (mins + ' min' + (mins == 1 ? '' : 's')))
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
	if(message.channel.type === 'dm') {
		let stranger = db.prepare('SELECT stranger_id FROM profile WHERE user_id = ?').get(user.id)
		if(stranger && stranger.stranger_id)
			client.users.get(stranger.stranger_id).send(message.content)
	}
})

function doHelp(message, user) {
	const helpEmbed = new Discord.RichEmbed()
		.setColor('#4D70EF')
		.setTitle('List of commands')
		.addField('**Registration**', '**s!register** - Register an account \n**s!unregister** - Unregister / Delete your current account')
		.addField('**Status**', '\n**s!status** - Check your current availability status \n**s!strangers** - Shows how many strangers are currently available in queue')
		.addField('**Matching**', '**s!available** - Changes your status to Available (Adds you in queue for matchmaking) \n**s!unavailable** - Changes your status to Unavailable (Unqueue you from the matchmaking) \n**s!next** - Leaves the current conversation and matches you with another stranger \n**s!leave** - Leave the current conversation (automatically unqueues you)\n**s!time** - Shows how long you have been paired with stranger\n**s!block [number]** - Blocks the stranger that you were matched with (not indicating a number will block the current paired stranger, indicating "1" will block the previous stranger)\n**s!unblock [number]** - Unblocks the stranger that you havea blocked (not indicating a number will show how many strangers have been blocked, the number will indicate the stranger\'s position in your blocklist)\n**s!report <reason> [attachment]** - Report the current stranger (indicate the reason and an attachment of your proof or evidence)')
	message.channel.send(helpEmbed);
}

function getBlockTarget(check, args, list) {
	let target = args.length ? false : check.stranger_id,
		wording = 'stranger'
	if(!target && list[0]) { // check to see if there are args specifying past strangers and if so that there are past strangers
		if(['last', 'previous', '1', '-1'].includes(args[0])) { //checks for any keywords for last stranger
			target = list[0]
			wording = 'previous ' + wording
		}
		const num = parseInt(args[0])
		if(!isNaN(num) && (num > 1 || num < -1)) {//otherwise check if it's strangers before the last one and if so that it's existent
			const abs = Math.abs(num)
			if(list.length >= abs){
				target = list[abs - 1]
				wording = 'last ' + wording + ' from ' + abs + ' strangers ago'
			}
		}
	}
	return [target, wording]
}

function doLeave(message, user) {
	let check = db.prepare('SELECT stranger_id, past_strangers FROM profile WHERE user_id = ?').get(user.id)
	if(check && check.stranger_id) {
		let past_strangers = check.past_strangers.split(sql_arr_sep).filter(Boolean),
			stranger = check.stranger_id
		past_strangers = [stranger].concat(past_strangers.length > stranger_history_limit ? past_strangers.slice(0, stranger_history_limit) : past_strangers).join(sql_arr_sep)
		db.prepare('UPDATE profile SET stranger_id = ?, past_strangers = ? WHERE user_id = ?').run('', past_strangers, user.id)
		check = db.prepare('SELECT stranger_id, past_strangers FROM profile WHERE user_id = ?').get(stranger)
		past_strangers = check.past_strangers.split(sql_arr_sep).filter(Boolean)
		past_strangers = [user.id].concat(past_strangers.length > stranger_history_limit ? past_strangers.slice(0, stranger_history_limit) : past_strangers).join(sql_arr_sep)
		db.prepare('UPDATE profile SET stranger_id = ?, past_strangers = ? WHERE user_id = ?').run('', past_strangers, stranger)
		message.channel.send('Left conversation...')
		client.users.get(stranger).send('Stranger has left the conversation...')
	}
}

function doAvailable(message, user) {
	let check = db.prepare('SELECT available, stranger_id, blocked_strangers FROM profile WHERE user_id = ?').get(user.id)
	const blocked_strangers = check.blocked_strangers
	if(!check)
		return
	if(check.available)
		return message.channel.send(user + ', your status is already Available!')
	if(check.stranger_id)
		return message.channel.send(user + ', your status cannot be changed to available because you are currently matched with a stranger!')
	check = db.prepare('SELECT user_id, available, blocked_strangers FROM profile WHERE available = true').all()
	if(check) {
		let stranger = ''
		for(let i of check) {
			stranger_blocks = i.blocked_strangers
			const r = Math.floor(Math.random() * check.length)
			stranger = check[r].user_id
			let avail = check[r].available
			if(!avail)
				continue
			if(blocked_strangers.includes(stranger) || stranger_blocks.includes(user.id))
				continue
			db.prepare('UPDATE profile SET available = false, stranger_id = ?, stranger_ts = DATETIME("now", "localtime") WHERE user_id = ?').run(stranger, user.id)
			db.prepare('UPDATE profile SET available = false, stranger_id = ?, stranger_ts = DATETIME("now", "localtime") WHERE user_id = ?').run(user.id, stranger)
			message.channel.send('Matched with a stranger, have a nice chat!')
			client.users.get(stranger).send('Matched with a stranger!')
			return
		}
	}
	db.prepare('UPDATE profile SET available = true WHERE user_id = ?').run(user.id)
	message.channel.send('Availability turned on!')
	return
}

client.login(config.token)

//Handle Windows platform Ctrl + C input on the console
if(process.platform === 'win32') {
	let rl = require('readline').createInterface({
		input: process.stdin,
		output: process.stdout
	})
	rl.on('SIGINT', function() {
		process.emit('SIGINT')
	})
}

//On program termination log and close client cleanly before exiting
process.on('SIGINT', function() {
	console.log(client.user.username + ' quitting...')
	client.destroy()
	process.exit()
})