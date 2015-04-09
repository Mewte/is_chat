//turn this into a module as needed
//log everything here so we can change it in one place

var config = require("../config.js");
module.exports = {
	/*
	 * data: data to log
	 * level: Level of logging, "1 = info, 2 = error
	 */
	log:function(data,level){
		if (config.logging.enabled){
			console.log(data.toJSON());
		}
	}
};