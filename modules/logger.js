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
			var now = new Date();
			var d = [
			  now.getFullYear(),
			  '-',
			  now.getMonth() + 1,
			  '-',
			  now.getDate(),
			  ' ',
			  now.getHours(),
			  ':',
			  now.getMinutes(),
			  ':',
			  now.getSeconds()
			].join('');
			console.log(d+": "+JSON.stringify(jsonFriendlyError(data)));
		}
	}
};
function jsonFriendlyError(err, filter, space) {
	if (typeof err !== 'object'){
		return err;
	}
	var plainObject = {};
	Object.getOwnPropertyNames(err).forEach(function (key) {
		plainObject[key] = err[key];
	});
	return plainObject;
}
;