var config = require("../config")
module.exports = require('knex')({
	debug: config.db.debug,
	client: 'mysql',
	connection: {
		host     : config.db.host,
		user     : config.db.user,
		password : config.db.pass,
		database : config.db.name,
		timezone: "UTC"
	},
	pool:{
		min: 2,
		max: 10
	}
});