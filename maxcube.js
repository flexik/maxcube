var MaxCubeLowLevel = require('./maxcube-lowlevel');
var MaxCubeCommandParser = require('./maxcube-commandparser');
var MaxCubeCommandFactory = require('./maxcube-commandfactory');
var Promise = require('bluebird');
var util = require('util');
var EventEmitter = require('events').EventEmitter;

// Constructor
function MaxCube(ip, port) {
  var self = this;
  this.maxCubeLowLevel = new MaxCubeLowLevel(ip, port);
  this.maxCubeLowLevel.connect();

  this.waitForCommandType = undefined;
  this.waitForCommandResolver = undefined;

  this.commStatus = {
    duty_cycle: 0,
    free_memory_slots: 0,
  }
  this.roomCache = [];
  this.deviceCache = {};

  this.maxCubeLowLevel.on('closed', function () {
    self.emit('closed');
  });

  this.maxCubeLowLevel.on('connected', function () {
    self.emit('connected');
  });

  this.maxCubeLowLevel.on('command', function (command) {
    var parsedCommand = MaxCubeCommandParser.parse(command.type, command.payload);
    if (self.waitForCommandType === command.type && self.waitForCommandResolver) {
      self.waitForCommandResolver.resolve(parsedCommand);
      self.waitForCommandType = undefined;
      self.waitForCommandResolver = undefined;
    }

    switch (command.type) {
      case 'H': {
        self.commStatus.duty_cycle = parsedCommand.duty_cycle;
        self.commStatus.free_memory_slots = parsedCommand.free_memory_slots;
        break;
      }
      case 'M': {
        self.roomCache = parsedCommand.rooms;
        self.deviceCache = parsedCommand.devices;
        break;
      }
    }
  });
}

util.inherits(MaxCube, EventEmitter);

function waitForCommand (commandType) {
  this.waitForCommandType = commandType;
  this.waitForCommandResolver = Promise.defer();
  return this.waitForCommandResolver.promise;
}

function send (command, replyCommandType) {
  var self = this;
  return self.getConnection().then(function () {
    self.maxCubeLowLevel.send(command);

    if (replyCommandType) {
      return waitForCommand.call(self, replyCommandType);
    } else {
      return Promise.resolve();
    }
  });
}

MaxCube.prototype.getConnection = function() {
  return this.maxCubeLowLevel.connect();
}

MaxCube.prototype.getCommStatus = function() {
  return this.commStatus;
}

MaxCube.prototype.getDeviceStatus = function(rf_address) {
  return send.call(this, 'l:\r\n', 'L').then(function (devices) {
    if (rf_address) {
      return devices.filter(function(device) {
        return device.rf_address === rf_address;
      });
    } else {
      return devices;
    }
  });
};

MaxCube.prototype.getDevices = function() {
  return this.deviceCache;
};

MaxCube.prototype.getDeviceInfo = function(rf_address) {
  var deviceInfo = {
    device_type: null,
    device_name: null,
    room_name: null,
    room_id: null,
  };

  var device = this.deviceCache[rf_address];
  if (device) {
    deviceInfo.device_type = device.device_type;
    deviceInfo.device_name = device.device_name;

    if (device.room_id && this.roomCache[device.room_id]) {
      var room = this.roomCache[device.room_id];
      deviceInfo.room_name = room.room_name;
      deviceInfo.room_id = room.room_id;
    }
  }
  
  return deviceInfo;
};

MaxCube.prototype.getRooms = function() {
  return this.roomCache;
};

MaxCube.prototype.flushDeviceCache = function() {
  return send.call(this, 'm:\r\n');
};

MaxCube.prototype.setTemperature = function(rf_address, degrees) {
  var self = this;
  degrees = degrees < 2 ? 2 : degrees;
  var command = MaxCubeCommandFactory.generateSetTemperatureCommand (rf_address, this.deviceCache[rf_address].room_id, 'MANUAL', degrees);
  return send.call(this, command, 'S').then(function (res) {
    self.commStatus.duty_cycle = res.duty_cycle;
    self.commStatus.free_memory_slots = res.free_memory_slots;
    return res.accepted;
  });
};

MaxCube.prototype.close = function() {
  this.maxCubeLowLevel.close();
};

module.exports = MaxCube;