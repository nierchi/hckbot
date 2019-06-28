const Discord = require('discord.js')
const client = new Discord.Client()
const config = require('./config.json')
const db = require('better-sqlite3')('register.db', {verbose: console.log})
const registry = {}
const available = []
const convos = {}

client.on('ready', () => {
	const table = db.prepare("SELECT count(*) FROM sqlite_master WHERE type='table' AND name = 'profile';").get();
	if (!table['count(*)']) {
		db.prepare("CREATE TABLE profile (user_id INTEGER NOT NULL PRIMARY KEY UNIQUE, user_name TEXT NOT NULL, user_desc TEXT, available BOOLEAN DEFAULT false);").run();
		db.prepare("CREATE UNIQUE INDEX user_profile_id ON profile (user_id);").run();
		db.pragma("synchronous = 1");
		db.pragma("journal_mode = wal");
	}
	console.log('Running...')
})

client.on('message', message => {
	const user = message.author
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
				message.channel.send('Registered!')
				return
				break
			case 'unregister':
				check = db.prepare('SELECT user_id FROM profile WHERE user_id = ?').get(user.id)
				if(!check)
					return
				db.prepare('DELETE FROM profile WHERE user_id = ?').get(user.id)
				message.channel.send('Unregistered...')
				delete registry[user.id]
				return
				break
			case 'available':
				if(available.includes(user.id))
					return
				if(available.length > 0) {
					const r = Math.floor(Math.random() * available.length)
					const stranger = available[r]
					available.splice(r, 1)
					convos[user.id] = stranger
					convos[stranger] = user.id
					message.channel.send('Matched with a stranger, have a nice chat!')
					client.users.get(stranger).send('Matched with stranger!')
					return
				}
				available.push(user.id)
				message.channel.send('Availability turned on!')
				return
				break
			case 'unavailable':
				return
				break
			case 'leave':

				return
				break
			default:
				break
		}
	}
	if(convos.hasOwnProperty(user.id))
		client.users.get(convos[user.id]).send(message.content)
	
})

client.login(config.token)