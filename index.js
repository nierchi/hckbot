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
		let check = false
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
			default:
				break
		}
	}
	let stranger = db.prepare('SELECT stranger_id FROM profile WHERE user_id = ?').get(user.id)
	if(message.channel.type === 'dm' && stranger && stranger.stranger_id)
		client.users.get(stranger.stranger_id).send(message.content)
})

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
			db.prepare('UPDATE profile SET available = false, stranger_id = ? WHERE user_id = ?').run(stranger, user.id)
			db.prepare('UPDATE profile SET available = false, stranger_id = ? WHERE user_id = ?').run(user.id, stranger)
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