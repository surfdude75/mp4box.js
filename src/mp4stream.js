var util = require('util');
var events = require('events');

var MP4Stream = function () {
	events.EventEmitter.call(this);
	this.fileStart = 0;
	this.stream = new MultiBufferStream();
};

util.inherits(MP4Stream, events.EventEmitter);

MP4Stream.prototype.append = function(ab,fileStart) {
	if (ab.byteLength===0) return;
	ab.usedBytes = 0;
	if (!ab.fileStart) ab.fileStart = this.fileStart;
	this.fileStart = ab.fileStart + ab.byteLength; 
	this.stream.insertBuffer(ab);
	this.parse();
};

MP4Stream.prototype.parse = function() {
	var parseBoxHeadersOnly = false;
	if (!this.restoreParsePosition()) return;
	while (true) {
		if (this.hasIncompleteMdat()) {
			if (this.processIncompleteMdat()) continue;
			else return;
		} else {
			this.saveParsePosition();
			console.log('BoxParser.parseOneBox',this.stream.getPosition(),this.stream.getEndPosition());
			var ret = BoxParser.parseOneBox(this.stream, parseBoxHeadersOnly);
			if (ret.code === BoxParser.ERR_NOT_ENOUGH_DATA) {	
				if (this.processIncompleteBox(ret)) continue;
				else return;
			} else {
				this.emit('box',ret.box);
				this.updateUsedBytes(ret.box, ret);	
			}
		}
	}
};

MP4Stream.prototype.lastBoxStartPosition = 0;
MP4Stream.prototype.parsingMdat = null;
MP4Stream.prototype.discardMdatData = false;

MP4Stream.prototype.processIncompleteBox = function(ret) {	
	var merged = this.stream.mergeNextBuffer();
	if (ret.type === "mdat") { 
		var box = new BoxParser[ret.type+"Box"](ret.size);	
		box.start = ret.start;
		box.hdr_size = ret.hdr_size;
		this.parsingMdat = box;
	}
	return merged;
}

MP4Stream.prototype.hasIncompleteMdat = function () {
	return (this.parsingMdat !== null);
}

MP4Stream.prototype.processIncompleteMdat = function () {
	var merged = this.stream.mergeNextBuffer();
	if (!merged) return merged;
	var box = this.parsingMdat;
	var found = this.stream.seek(box.start + box.size, false, this.discardMdatData);
	if (found) {
		this.stream.seek(box.start+box.hdr_size, false, this.discardMdatData);
		box.data = this.stream.readUint8Array(box.size-box.hdr_size);
		this.emit('box',box);
		this.parsingMdat = null; 
	}
	return found;
}

MP4Stream.prototype.restoreParsePosition = function() {
	/* Reposition at the start position of the previous box not entirely parsed */
	return this.stream.seek(this.lastBoxStartPosition, true, this.discardMdatData);
}

MP4Stream.prototype.saveParsePosition = function() {
	/* remember the position of the box start in case we need to roll back (if the box is incomplete) */
	this.lastBoxStartPosition = this.stream.getPosition();	
}

MP4Stream.prototype.updateUsedBytes = function(box, ret) {
	if (box.type === "mdat") {
		/* for an mdat box, only its header is considered used, other bytes will be used when sample data is requested */
		this.stream.addUsedBytes(box.hdr_size);
		if (this.discardMdatData) {
			this.stream.addUsedBytes(box.size-box.hdr_size);
		}
	} else {
		/* for all other boxes, the entire box data is considered used */
		this.stream.addUsedBytes(box.size);
	}	
}

if (typeof exports !== 'undefined') {
	exports.MP4Stream = MP4Stream;	
}
