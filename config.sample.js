module.exports = {
	environment: "dev",
	chat:{
		listen_on: 8088
	},
	sockets:{
		ipc:{
			host:"localhost",
			port:8088
		},
		listen_on:8080
	},
	db:{
		host:"localhost",
		user:"root",
		pass:"",
		name:"instasynch"
	}
};