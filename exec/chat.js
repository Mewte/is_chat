/*
 * Chat Server Core Code
 * Clients -> Socket.IO Clusters -> Server Core(THIS APPLICATION)
 */
var config = require("../config");
var request = require("request");
var commands = require("../obj/commands");
var room = require("../obj/room");
var Socket = require("../modules/socket");
var parser = require("../obj/parsers");
var crypto = require('crypto');
var fs = require('fs');

global.phploc = config.chat.phploc;
process.on('uncaughtException', function (error) {
	console.log("UNHANDLED ERROR! Logged to file.");
	throw (error)
	//fs.appendFile("crashlog.txt", error.stack + "---END OF ERROR----", function () {});
});
//object table, clusters is an object of clusters which are objects of sockets.
var webServer = require('http').createServer(function (req, res) {
	res.writeHead(404);
	res.end("No resource found.");
});
global.io = require('socket.io')(webServer);
global.rooms = {};
global.clusters = {};

webServer.listen(config.chat.listen_on);

io.use(function(socket,next){
	var token = socket.handshake.query.auth;
	next();
});
io.set('transports', ['websocket']);

io.on('connection', function(ipc_client){
	console.log(ipc_client.conn.transport.name);
	ipc_client.on("online",function(data,callback){
		if (clusters[ipc_client.id] == undefined){
			clusters[ipc_client.id] = {};
			callback({status:"ok"});
		}
		else
			callback({status:"notok"});
	});
	ipc_client.on("message",function(msg,callback){
		var socket;
		if (clusters[ipc_client.id][msg.socket_id] == undefined){
			if (msg.handshake != undefined){
				socket = new Socket(ipc_client.id,msg.socket_id,
					{
						username: msg.handshake.username,
						cookie: msg.handshake.cookie,
						room: msg.handshake.room,
						ip: msg.handshake.ip
					}
				);
				clusters[ipc_client.id][msg.socket_id] = socket;
			}
			else{
				return;//dont continue, handshake data not provided and socket is undefined
			}
		}
		else{
			if (clusters[ipc_client.id][msg.socket_id] == -1){
				return;
			}
			socket = clusters[ipc_client.id][msg.socket_id];
		}
		switch(msg.type)
		{
			case "join":
					join(socket,callback);
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
	ipc_client.on("disconnect", function(){
		console.log("Cluster: "+ipc_client.id+" disconnected!")
	});
	//if (config.environment != "dev")
	ipc_client.on("error", function(e){
		console.log(jsonFriendlyError(e));
		ipc_client.emit("error_occured",{});//emit that an error occured, giving the socket a chance to cleanly end itself (and reconnect)
		ipc_client.disconnect();
	});
});
function join(user){
	if (!user.joined){
		var roomname = user.handshake.room.toLowerCase();
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
						io.to(user.cluster_id).emit("message",{type:"emit", socket_id: user.socket_id, event:"sys-message", data:{ message: "Room loaded into memory, refresh page."}});
						io.to(user.cluster_id).emit("message",{type:"disconnect", socket_id: user.socket_id});
					}
					else
					{
						io.to(user.cluster_id).emit("message",{type:"emit",socket_id: user.socket_id, event:"sys-message", data:{ message: "Room is stil loading, refresh page."}});
						io.to(user.cluster_id).emit("message",{type:"disconnect", socket_id: user.socket_id});
					}
				}
				else
				{
					io.to(user.cluster_id).emit("message",{type:"emit", socket_id: user.socket_id, event:"sys-message", data:{ message: "This room does not exist."}});
					io.to(user.cluster_id).emit("message",{type:"disconnect", socket_id: user.socket_id});
				}
			});
		}
		else //room in memory
		{
			request.post(phploc + 'data/parseuser.php',
				{
					form:{
						username: user.handshake.username,
						cookie: user.handshake.cookie,
						ip: user.handshake.ip,
						room: roomname}
				},
				function(e, r, msg)
				{
					if (clusters[user.cluster_id][user.socket_id] == undefined) //if the socket disconnected by the time this runs, stop
						return;
					try {var response = JSON.parse(msg); } catch(ex) {console.log("JSON from parseuser.php not valid?" + e +"response:"+ msg); return;}
					if (response.error)
					{
						io.to(user.cluster_id).emit("message",{type:"emit",socket_id: user.socket_id, event:"sys-message", data:{ message: response.error}});
						io.to(user.cluster_id).emit("message",{type:"disconnect", socket_id: user.socket_id});
					}
					else
					{
						var hashedIp = crypto.createHash('md5').update("Random Salt Value: $33x!20" + user.handshake.ip).digest("hex").substring(0, 11);
						var hashedId = crypto.createHash('md5').update("RandomTest"+user.socket_id).digest("hex");
						user.info = {username: response.user.username, permissions: response.user.permissions, room: roomname,
									   loggedin: response.user.loggedin, ip: user.handshake.ip, hashedIp: hashedIp,hashedId: hashedId,
									   skipped: false, voteinfo: {voted: false, option: null}};
						if (rooms[user.info.room] != undefined)
						{
							rooms[user.info.room].tryJoin(user);
						}
					}
				});
		}
	}
}
function rename(user, newUsername){
	if (user.joined)
	{
		if (user.info.username == "unnamed")
		{
			rooms[user.info.room].rename(user, newUsername);
		}
	}
}
function disconnect(user){
	if (user.joined)
	{
		if (rooms[user.info.room] != undefined)
		{
			rooms[user.info.room].leave(user);
		}
	}
	/*
	set it to -1 so we know it's being cleaned up.
	I fear that if we don't, there's a chance that sockets.js might send a message shortly after 
	even though it's considered 'disconnected', due to the async nature of node.js messages.
	*/
	clusters[user.cluster_id][user.socket_id] = -1;
	setTimeout(function(){
		delete clusters[user.cluster_id][user.socket_id];
	},10000);
}
function message(user, message){
	if (user.joined && user.info.username.toLowerCase() != "unnamed")
	{
		rooms[user.info.room].chatmessage(user, parser.replaceTags(message));
	}
}
function command(user, data){
	if (data.command != undefined && commands.commands[data.command] !=  undefined && user.joined)
	{
		if (data.data !== undefined) //TODO: Check if data is not null for certain commands
		{
			if (data.data === null)
			{
				data.data = {}; //help prevent crash when null is sent but needed.
				//commands.js will see this as an object and thus .property will trigger the undefined checks
			}
			commands.commands[data.command](data.data, user);
		}
	}
}
function jsonFriendlyError(err, filter, space) {
	var plainObject = {};
	Object.getOwnPropertyNames(err).forEach(function (key) {
		plainObject[key] = err[key];
	});
	return plainObject;
}