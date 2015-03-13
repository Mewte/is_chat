//Just an encapsulated socket object to be stored inside the cluster array
//io is global, just /deowitit for now
//Note: This is sort of a wrapper of the old socket.io object that was past around, this replicates some of the old functionality so can make minimal code changes
function socket(cluster_id,socket_id,handshake){
	this.cluster_id = cluster_id;
	this.socket_id = socket_id;
	this.handshake = handshake;
	this.info = {};
	this.joined = false;
}
socket.prototype.emit = function(event,data){
	io.to(this.cluster_id).emit("message",{type:"emit",socket_id: this.socket_id, event:event, data:data});
};
socket.prototype.broadcast = function(event,data){

};
socket.prototype.disconnect = function(){
	io.to(this.cluster_id).emit("message",{type:"disconnect", socket_id: socket.socket_id,room:this.info.room});
};
socket.prototype.join = function(room){
	io.to(this.cluster_id).emit("message",{type:"join", socket_id: this.socket_id, room: room});
};
socket.toRoom = function(room,event,data){ //socket static function for broadcasting to room
	io.emit("message",{type:"room_emit", room: room, event:event, data:data});
};
module.exports = socket;