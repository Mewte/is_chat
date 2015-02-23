/*
 * Chat Server Core Code
 * Clients -> Socket.IO Clusters -> Server Core(THIS APPLICATION)
 */
var config = require("./config");
var knex = require('knex')({
	client: 'mysql',
	connection: {
		host     : config.db_host,
		user     : config.db_user,
		password : config.db_pass,
		database : config.db_name
	},
	pool:{
		min: 2,
		max: 10
	}
});
process.on('uncaughtException', function (error) {
	//console.log("UNHANDLED ERROR! Logged to file.");
	throw (error);
	//fs.appendFile("crashlog.txt", error.stack + "---END OF ERROR----", function () {});
});
//object table, clusters is an object of clusters which are objects of sockets.
var webServer = require('http').createServer(function (req, res) {
	res.writeHead(404);
	res.end("No resource found.");
});
var io = require('socket.io')(webServer);
webServer.listen(config.listen_port);


io.use(function(socket,next){
	var token = socket.handshake.query.auth;
	next();
});
var rooms = [];
var clusters = {};
io.on('connection', function(socket){
	socket.on("online",function(data,callback){
		socket.cluster_id = data.cluster_id;
		if (clusters[socket.cluster_id] == undefined){
			clusters[socket.cluster_id] = {};
			callback({ok:true});
		}
		else
			callback({ok:false});
	});
	socket.on("message",function(msg,callback){
		switch(msg.type)
		{
			case "join":
				join(socket, msg.data.username, msg.data.cookie, msg.data.room);
				break;
			case "rename":
				rename(socket, msg.data.username);
				break;
			case "disconnect":
				disconnect(socket);
				break;
			case "chat":
				message(socket, msg.data.message);
				break;
			case "command":
				command(socket, msg.data.data);
				break;
		}

	});
});
function join(socket, username, cookie, roomname){
	if (!socket.joined)
	{
		roomname = roomname.toLowerCase();
		if (rooms[roomname] == undefined) //room not in memory
		{
			request.post(phploc + 'data/roominfo.php', {form:{ room: roomname}}, function(e, r, msg)
			{
				try {var result = JSON.parse(msg)} catch(e) {console.log("Room JSON not valid?"); return;}
				if (result.error == undefined )
				{
					if (rooms[roomname] == undefined) //check to be sure the room is still undefined
					{
						rooms[roomname] = room.create(roomname);
						socket.emit('sys-message', { message: "Room loaded into memory, refresh page."});
						socket.attemptDisconnect();
					}
					else
					{
						socket.emit('sys-message', { message: "Room is stil loading, refresh page."});
						socket.attemptDisconnect();
					}
				}
				else
				{
					socket.emit('sys-message', { message: "This roomname does not exist."});
					socket.attemptDisconnect();
				}
			});
		}
		else //room in memory
		{
			var socketIp = "";
			try {
				//(socketIp = socket.manager.handshaken[socket.id].address.address);
				(socketIp = socket.handshake.headers['cf-connecting-ip'] || socket.handshake.address.address);
			} catch (e)
			{console.log("Error with socket IP address"); return;}
			request.post(phploc + 'data/parseuser.php', {form:{username: username, cookie: cookie, ip: socketIp,
															   room: roomname}}, function(e, r, msg)
			{
				//data to send back from php file: username, permissions, class, style
				if (socket.connected == false) //if the socket disconnected by the time this runs, stop
					return;
				try {var response = JSON.parse(msg); } catch(ex) {console.log("JSON from parseuser.php not valid?" + e +"response:"+ msg); return;}
				if (response.error)
				{
					socket.emit('sys-message', {message: response.error});
					socket.attemptDisconnect();
				}
				else
				{
					var user = response.user;
					var hashedIp = crypto.createHash('md5').update("Random Salt Value: $33x!20" + socketIp).digest("hex").substring(0, 11);
					socket.info = {username: user.username, permissions: user.permissions, room: roomname,
								   loggedin: user.loggedin, ip: socketIp, hashedIp: hashedIp,
								   skipped: false, voteinfo: {voted: false, option: null}};
					if (rooms[socket.info.room] != undefined)
					{
						rooms[socket.info.room].tryJoin(socket);
					}
				}
			});
		}
	}
}
function rename(socket, newUsername){
	if (socket.joined)
	{
		if (socket.info.username == "unnamed")
		{
			rooms[socket.info.room].rename(socket, newUsername);
		}
	}
}
function disconnect(socket){
	socket.connected = false;
	if (socket.joined)
	{
		if (rooms[socket.info.room] != undefined)
		{
			rooms[socket.info.room].leave(socket);
		}
	}
	//socket.disconnect(); //causes error..?
}
function message(socket, message){
	if (socket.joined && socket.info.username.toLowerCase() != "unnamed")
	{
		rooms[socket.info.room].chatmessage(socket, parser.replaceTags(message));
	}
}
function command(socket, data){
	if (data.command != undefined && commands.commands[data.command] !=  undefined && socket.joined)
	{
		if (data.data !== undefined) //TODO: Check if data is not null for certain commands
		{
			if (data.data === null)
			{
				data.data = {}; //help prevent crash when null is sent but needed.
				//commands.js will see this as an object and thus .property will trigger the undefined checks
			}
			commands.commands[data.command](data.data, socket);
		}
	}
}