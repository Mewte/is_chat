var config = require("../config")
module.exports = require('knex')({
	client: 'mysql',
	connection: {
		host     : config.db.host,
		user     : config.db.user,
		password : config.db.pass,
		database : config.db.name
	},
	pool:{
		min: 2,
		max: 10
	}
});