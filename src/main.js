import hue from "node-hue-api";
const { HueApi, lightState } = hue;
import sdk from '@scrypted/sdk';
const { deviceManager, log } = sdk;

Error.captureStackTrace = function () {
}

function HueHub() {
  this.devices = {};
};

HueHub.prototype.getDevice = function (id) {
  return this.devices[id];
}

HueHub.prototype.updateLights = function (result) {
  var devices = [];
  var payload = {
    devices: devices,
  };

  // 182.5487

  for (var light of result.lights) {
    var interfaces = ['OnOff', 'Brightness', 'Refresh'];
    if (light.type.toLowerCase().indexOf('color') != -1) {
      interfaces.push('ColorSettingHsv');
      interfaces.push('ColorSettingTemperature');
    }

    var device = {
      nativeId: light.id,
      name: light.name,
      interfaces: interfaces,
      type: 'Light',
    };

    log.i(`Found device: ${JSON.stringify(device)}`);
    devices.push(device);

    this.devices[light.id] = new HueBulb(this.api, light, device);
  }

  deviceManager.onDevicesChanged(payload);
}

var hueHub = new HueHub();

const StateSetters = {
  OnOff: function (s, state) {
    state.on = !!(s && s.on);
  },
  Brightness: function (s, state) {
    state.brightness = (s && s.bri && (s.bri * 100 / 254)) || 0;
  },
  ColorSettingTemperature: function (s, state) {
    state.colorTemperature = (s && s.ct && (1000000 / s.ct)) || 0;
  },
  ColorSettingHsv: function (st, state) {
    var h = (st && st.hue && st.hue / 182.5487) || 0;
    var s = (st && st.sat && (st.sat / 254));
    var v = (st && st.bri && (st.bri / 254));
    state.hsv = { h, s, v };
  }
}

function HueBulb(api, light, device) {
  this.id = light.id;
  this.api = api;
  this.light = light;
  this.device = device;

  this.refresher = (err) => {
    this._refresh();
  }

  // wait for this device to be synced, then report the current state.
  setImmediate(() => {
    this.state = deviceManager.getDeviceState(this.id);
    this.updateState(light.state);
  });
}

HueBulb.prototype.updateState = function(state) {
  for (var event of this.device.interfaces) {
    var setter = StateSetters[event];
    if (setter) {
      setter(state, this.state);
    }
  }
}

HueBulb.prototype._refresh = function (cb) {
  this.api.lightStatus(this.id, function(err, result) {
    if (result && result.state) {
      this.updateState(result.state);
    }
    if (cb) {
      cb(err);
    }
  }.bind(this));
}

HueBulb.prototype.refresh = function() {
  this._refresh();
}

HueBulb.prototype.getRefreshFrequency = function() {
  return 5;
}

HueBulb.prototype.turnOff = function () {
  this.api.setLightState(this.id, lightState.create().turnOff(), this.refresher);
};

HueBulb.prototype.turnOn = function () {
  this.api.setLightState(this.id, lightState.create().turnOn(), this.refresher);
};

HueBulb.prototype.setBrightness = function (level) {
  this.api.setLightState(this.id, lightState.create().brightness(level), this.refresher);
}

HueBulb.prototype.setTemperature = function (kelvin) {
  var mired = Math.round(1000000 / kelvin);
  this.api.setLightState(this.id, lightState.create().ct(mired), this.refresher);
}

HueBulb.prototype.setHsv = function (h, s, v) {
  this.api.setLightState(this.id, lightState.create().hsb(h, s * 100, v * 100), this.refresher);
}

HueBulb.prototype.getTemperatureMinK = function () {
  return Math.round(1 / (this.light.capabilities.control.ct.max) * 1000000);
}

HueBulb.prototype.getTemperatureMaxK = function () {
  return Math.round(1 / (this.light.capabilities.control.ct.min) * 1000000);
}

var bridgeId = localStorage.getItem('bridgeId');
var bridgeAddress = localStorage.getItem('bridgeAddress');;
if (!bridgeId) {
  log.i('No "bridgeId" was specified in Plugin Settings. Press the pair button on the Hue bridge.');
  log.i('Searching for Hue Bridge...');
}
else {
  var username = localStorage.getItem(`user-${bridgeId}`);
  if (username) {
    log.i(`Using existing login for bridge ${bridgeId}`);
  }
  else {
    log.i(`No login found for ${bridgeId}. You will need to press the pairing button on your Hue bridge, and the save plugin to reload it.`);
  }
}

var displayBridges = function (bridges) {
  if (!bridgeId) {
    if (bridges.length == 0) {
      log.e('No Hue bridges found');
      return;
    }
    else if (bridges.length != 1) {
      log.e('Multiple hue bridges found: ');
      for (var found of bridges) {
        log.e(found.id);
      }
      log.e('Please specify which bridge to manage using the Plugin Setting "bridgeId"');
      return;
    }

    bridgeId = bridges[0].id;
    log.i(`Found bridge ${bridgeId}. Setting as default.`);
    localStorage.setItem('bridgeId', bridgeId);
  }

  var foundAddress;
  for (var found of bridges) {
    if (found.id == bridgeId) {
      foundAddress = found.ipaddress;
      break;
    }
  }

  if (!foundAddress) {
    if (!bridgeAddress) {
      log.e(`Unable to locate bridge address for bridge: ${bridgeId}.`);
      return;
    }

    log.w('Unable to locate most recent bridge address with nupnp search. using last known address.')
  }
  else {
    bridgeAddress = foundAddress;
  }
  localStorage.setItem('bridgeAddress', bridgeAddress);

  log.i(`Hue Bridges Found: ${bridgeId}`);
  log.i('Querying devices...');


  async function listDevices(host, username) {
    log.clearAlerts();

    var api = new HueApi(host, username);
    hueHub.api = api;
    try {
      var result = await api.lights();
      log.i(`lights: ${result}`);

      hueHub.updateLights(result);
    }
    catch (e) {
      log.a(`Unable to list devices on bridge ${bridgeId}: ${e}`);
    }
  }

  log.clearAlerts();

  if (username) {
    log.i(`Using existing login for bridge ${bridgeId}`);
    listDevices(bridgeAddress, username);
    return;
  }

  const api = new HueApi();
  api.registerUser(bridgeAddress, 'ScryptedServer')
    .then((result) => {
      log.i(`Created user on ${bridgeId}: ${result}`);
      username = result;
      localStorage.setItem(`user-${bridgeId}`, result);
      return listDevices(bridgeAddress, username);
    })
    .catch((e) => {
      log.a(`Unable to create user on bridge ${bridgeId}: ${e}`);
      log.a('You may need to press the pair button on the bridge.');
    });
};

// --------------------------
// Using a promise
hue.nupnpSearch().then(displayBridges);


export default hueHub;
