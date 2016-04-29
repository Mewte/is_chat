var config = require("../config").friends;
var os = require("os");
var fs = require('fs');
var db = require("../modules/db");
var logger = require("../modules/logger");
var cookie = require('cookie');
var Promise = require("bluebird");
var parser = require("../obj/parsers");
var EventEmitter = require("events").EventEmitter;
var events = new EventEmitter();
events.setMaxListeners(0); //infinite listeners, we will be creating a listener for every socket in 'queue'

var app = require('express')();
app.use("*",function(req,res,next){
	res.header('hostname',os.hostname());
	res.send("No resource found.")
});
var webServer = require('http').Server(app);
var io = require('socket.io')(webServer);

var redis = require('redis').createClient;
var adapter = require('socket.io-redis');
var pub = redis(config.redis.port, config.redis.host, { auth_pass: config.redis.pass });
var sub = redis(config.redis.port, config.redis.host, { return_buffers: true, auth_pass: config.redis.pass });

sub.on("message", function (channel, message) {
	if (channel == "cluster_communications"){
		console.log(message.toString());
	}
});
sub.subscribe("cluster_communications");

io.adapter(adapter({ pubClient: pub, subClient: sub }));


db("friend_status").where({server_id: config.server_id}).del().then(function(){
	process.on('uncaughtException', function (error) {
		logger.log(jsonFriendlyError(error));
		logger.log("UNHANDLED ERROR! Logged to file.");
		fs.appendFile("friends_crashlog.log", error.stack + "---END OF ERROR----", function () {});
	});
	webServer.listen(config.listen_on);
}).catch(function(err){
	throw err;
});

io.use(function(socket, next){ //check if user is logged in and set _user property
	try{
		var cookies = cookie.parse(socket.handshake.headers.cookie); //this threw an exception in testing for some reason
	}
	catch(e){
		var cookies = {};
	}
	if (!cookies.auth_token || !cookies.username){
			var e = new Error("not_logged_in")
			return next(e);
	}
	db.select(["users.id as user_id", "users.username", "users.avatar", "users.bio", "users.created", "sessions.id as session_id"]).from('sessions').join("users", "sessions.user_id", "users.id")
			.where({"sessions.cookie": cookies.auth_token, "sessions.username": cookies.username}).limit(1).then(function (rows) {
		if (rows.length == 0){			
			var e = new Error("not_logged_in")
			return next(e);
		}
		else {
			 socket._user = rows[0];
			 next();
		}
	}).catch(function (err) {
		throw err;
	});
});
io.on('connection', function(socket) {
	//var ip = socket.client.request.headers['cf-connecting-ip'] || socket.client.conn.remoteAddress;
	Promise.all([
		socket._user,
		db.select(["id","username","avatar",db.raw("IFNULL(status,'offline') as status")]).from(db.union(function(){
				this.select("userA as friend_id").from("friends_list").where({userB:socket._user.user_id});
			}).union(function(){
				this.select("userB as friend_id").from("friends_list").where({userA:socket._user.user_id});
			}).as("a")).join('users','users.id','=','a.friend_id').joinRaw('LEFT JOIN (select user_id,"online" as status from friend_status GROUP BY user_id) as status on status.user_id = id'),
		db.select("friend_id","to_id","from_id","message","username","avatar","viewed",db.raw("UNIX_TIMESTAMP(sent) as sent")).from(
			db.union(function(){
				this.select("to_id","from_id","to_id as friend_id","message","sent","viewed").from("friend_messages").where({from_id: socket._user.user_id});
			}).union(function(){
				this.select("to_id","from_id","from_id as friend_id","message","sent","viewed").from("friend_messages").where({to_id: socket._user.user_id});
			}).orderBy("sent","desc").as("messages")).join("users","friend_id","users.id").groupBy("friend_id"),
		db.select(["friend_id","username",db.raw("IF(sentBy = "+socket._user.user_id+",'sent','received') as type"),"avatar"]).from(db.union(function(){
				this.select("userA as friend_id","sentBy").from("friend_requests").where({userB:socket._user.user_id});
			}).union(function(){
				this.select("userB as friend_id", "sentBy").from("friend_requests").where({userA:socket._user.user_id});
			}).as("a")).join('users','users.id','=','friend_id')
	]).spread(function(user,friends,messages,friend_requests){
		for (var i = 0; i < friends.length; i++){
			socket.join("id-"+friends[i].id);
		}
		socket.join("userClientsID-"+socket._user.user_id);
		socket.emit("start_up_data",{user: user,friends: friends,messages: messages,friend_requests: friend_requests});
		if (socket.connected){
			db("friend_status").insert({socket_id:socket.id,server_id:config.server_id,user_id:socket._user.user_id}).then(function(){
				io.to("id-"+socket._user.user_id).emit('online',{
					id: socket._user.user_id,
					username: socket._user.username
				});
			}).catch(function(err){

			});
		}
	}).catch(function(err){
		throw err;
	});
	socket.on('get_conversation', function(data, callback){
		//modify this to return array of messages and someway to know if there's more messages to scroll up
		if (data.beforeID){ //get messages before certain message ID (pagination)
			
		}
		if (data.user_id){
			db.select("to_id", "from_id", "message","viewed", db.raw("UNIX_TIMESTAMP(sent) as sent")).from("friend_messages")
			.where(function(){
				this.where("to_id",socket._user.user_id).where("from_id",data.user_id);
			}).orWhere(function(){
				this.where("from_id",socket._user.user_id).where("to_id",data.user_id);
			}).orderBy("sent", "asc").then(function(data){
				callback({error:false,messages:data,});
			}).catch(function(err){

			});
		}
	});
	socket.on('disconnect', function(data){
//		db("friend_status").where({socket_id:socket.id,server_id: config.server_id}).del().then(function(){}).catch(function(err){});
//		db("friend_status").count("*").where({user_id:socket._user.user_id}).then(function(count){
//
//		}).catch(function(err){
//			io.to("id-"+socket._user.user_id).emit('offline',{
//				id: socket._user.user_id,
//				username: socket._user.username
//			});
//		});
	});
	var currentCharacters = 0;
	var currentMessages = 0;
	var reduceMsgInterval = null; //reduce messages by 1 and characters by 100 every second
	socket.on('send_message', function(data,callback){
		if ((data.message != undefined) && (data.message.trim() != "") && data.user_id != undefined && callback != undefined){
			var message = parser.filterUnicode(data.message);
			message = message.toString().substring(0, 240);
			//increment message limits
			currentCharacters += data.message.length;
			currentMessages += 1;

			if (currentCharacters > 512 || currentMessages > 6)
			{
				currentCharacters = Math.min(768, currentCharacters);
				currentMessages = Math.min(9, currentMessages);
				callback({success:false,error_type:"flood"});
			}
			else
			{
				var userA = Math.min(data.user_id, socket._user.user_id);
				var userB = Math.max(data.user_id, socket._user.user_id);
				db.select("*").from("friends_list").where({userA: userA, userB: userB}).then(function (friend) { //check if users are friends
					if (friend.length == 0) {
						throw "not_friends";
					}
					else{
						return db("friend_messages").insert({to_id: data.user_id,from_id: socket._user.user_id,message: message});
					}
				}).then(function (inserted_id) {
					//broadcast to all of this users tabs that user sent a message
					//broadcast to receiver that he has new messages
					callback({success:true});
				}).catch(function (err) {
					if (err == "not_friends"){
						return callback({success:false,error_type:"not_friends"});
					}
					else{
						callback({success:false,error_type:"db_error"});
						throw err;
					}
				});
			}

			if (reduceMsgInterval === null)
			{
				reduceMsgInterval = setInterval(
				function(){
					currentCharacters -= 110;
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
	socket.on("send_friend_request",function(data,callback){

	});
	socket.on("accept_friend_request",function(data,callback){

	});
	socket.on("decline_friend_Request",function(data,callback){

	});
	
});
function jsonFriendlyError(err, filter, space) {
	var plainObject = {};
	Object.getOwnPropertyNames(err).forEach(function (key) {
		plainObject[key] = err[key];
	});
	return plainObject;
}