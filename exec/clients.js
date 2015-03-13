/*
 * Chat Server Socket.IO
 * Clients -> Socket.IO Clusters(THIS APPLICATION) -> Server Core
 */
var commandQueue = require("../obj/commandQueue");
var config = require("../config");
var client = require("socket.io-client");
//process.on('uncaughtException', function (error) {
//	//console.log("UNHANDLED ERROR! Logged to file.");
//	throw (error);
//	//fs.appendFile("crashlog.txt", error.stack + "---END OF ERROR----", function () {});
//});
var server = null;
var io = null;
ipc = client.connect('http://'+config.sockets.ipc.host+':'+config.sockets.ipc.port,{
	query: "auth=abc123",
	timeout: 5000,
	transports: ['websocket']
});
ipc.on('connect',function() {
	console.log("Connected to IPC!");
	ipc.emit("online",{},function(response){
		if (response.status == "ok"){
			console.log("Spawning Server..")
			server = new cluster(ipc);
		}
	});
});
ipc.on('message', function(msg,callback){
	switch (msg.type)
	{
		case "emit": //emit to single socket
			io.to(msg.socket_id).emit(msg.event, msg.data);
			break;
		case "room_emit": //all sockets in room
			io.sockets.in(msg.room).emit(msg.event, msg.data);
			break;
		case "room_broadcast": //all sockets in room except 'sender'
			if (io.sockets.connected[msg.socket_id]){
				io.sockets.connected[msg.socket_id].broadcast.to(msg.room).emit(msg.event, msg.data);
			}
			else
				io.sockets.in(msg.room).emit(msg.event, msg.data);
			break;
		case "disconnect": //disconnect socket
			if (io.sockets.connected[msg.socket_id]){
				console.log(msg);
				var socket = io.sockets.connected[msg.socket_id];
				if (msg.room)
					socket.leave(msg.room); //which room to leave is sent with the disconnect event so that we can ensure the user will no longer receive room emits during this disconnect period
				socket.emit('request-disconnect');
				setTimeout(function() //give socket a small delay to disconnect itself before we force boot it
				{
					socket.disconnect();
				}, 500);
			}
			break;
		case "join":
			//join socket.io room
			var socket = io.sockets.connected[msg.socket_id];
			if (socket)
				socket.join(msg.room);
			break;
		default:
			break;
	}
});
ipc.on('disconnect',function(){
	console.log("Disconnected from IPC!");
	if (server){
		console.log("Killing Server..");
		server.kill();
	}
});
ipc.on('connect_error', function(){
	console.log("connect_error");
});
ipc.on('connect_timeout',function(){
	console.log('connect_timeout');
});
function cluster(ipc){
	var webServer = require('http').createServer(function (req, res) {
		res.writeHead(404);
		res.end("No resource found.");
	});
	webServer.listen(8080);
	io = require('socket.io')(webServer);
	io.on('connection', function(socket) {
		var ip = socket.client.request.headers['cf-connecting-ip'] || socket.client.conn.remoteAddress;
		var joinEmitted = false;
		socket.on('join', function(data)
		{
			if (joinEmitted == false)
			{// this is a one time emit per socket connection
				if (data.username != undefined && data.cookie != undefined && data.room != undefined && data.room == socket.handshake.query.room)
				{
					ipc.emit("message",{type: "join",socket_id: socket.id,
						handshake: {
							username: data.username,
							cookie: data.cookie,
							room: data.room,
							ip: ip
						}
					});
				}
			}
			joinEmitted = true;
		});
		var renameEmitted = false;
		socket.on('rename', function(data)
		{
			if (data.username != undefined && data.username.toLowerCase() != "unnamed" && renameEmitted == false)
			{
				if (data.username.toLowerCase() == "mewte")
				{
					socket.emit("sys-message", {message: "b-but you are not Mewte..."});
				}
				else
				{
					ipc.emit("message",{type: "rename", socket_id: socket.id, data: {username: data.username}});
					renameEmitted = true;
				}
			}
		});
		socket.on('disconnect', function(data)
		{
			ipc.emit("message",{type: "disconnect", socket_id: socket.id});
		});
		var currentCharacters = 0;
		var currentMessages = 0;
		var reduceMsgInterval = null; //reduce messages by 1 and characters by 100 every second
		socket.on('message', function(data)
		{
			if ((data.message != undefined) && (data.message.trim() != "")){
				//increment message limits
				currentCharacters += data.message.length;
				currentMessages += 1;

				if (currentCharacters > 260 || currentMessages > 3)
				{
					socket.emit("sys-message", {message: "Please don't spam/flood the chat."});
					currentCharacters = Math.min(600, currentCharacters);
					currentMessages = Math.min(6, currentMessages);
				}
				else
				{
					ipc.emit("message",{type: "chat", socket_id: socket.id, data: {message: data.message}});
				}
				if (reduceMsgInterval === null)
				{
					reduceMsgInterval = setInterval(
					function(){
						currentCharacters -= 60;
						currentMessages -= 1;
						currentCharacters = Math.max(0, currentCharacters);
						currentMessages = Math.max(0, currentMessages);
						if (currentCharacters == 0 && currentMessages == 0)
						{
							clearInterval(reduceMsgInterval);
							reduceMsgInterval = null;
						}
					},1000);
				}
			}

		});
		var queue = commandQueue.create(6);
		socket.on('command', function(data)
		{
			queue.addCommand();
			if (queue.checkFlood()) //too many commands
			{
				socket.emit('sys-message', { message: "Too many commands. Disconnected."});
				socket.emit("request-disconnect");
				socket.disconnect();
				return;
			}
			if (joinEmitted){
				ipc.emit("message",{type: "command", socket_id: socket.id, data: {data: data}});
			}
		});
	});
	this.kill = function(){
		webServer.close();
	};
}