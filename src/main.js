import hue from "node-hue-api";
const { HueApi, lightState } = hue;

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
    var interfaces = ['OnOff', 'Brightness'];
    if (light.type.toLowerCase().indexOf('color') != -1) {
      interfaces.push('ColorSettingRgb');
      interfaces.push('ColorSettingHsv');
      interfaces.push('ColorSettingTemperature');
    }
    var events = interfaces.slice();
    interfaces.push('Refresh');

    var device = {
      id: light.id,
      name: light.name,
      interfaces: interfaces,
      events: events,
      type: 'Light',
    };

    log.i(`Found device: ${JSON.stringify(device)}`);
    devices.push(device);

    this.devices[light.id] = new HueBulb(light.id, this.api, light, device);
  }

  deviceManager.onDevicesChanged(payload);
}

var HueHub = new HueHub();

// h, s, v are all expected to be between 0 and 1.
// the h value expected by scrypted (and google and homekit) is between 0 and 360.
function HSVtoRGB(h, s, v) {
  var r, g, b, i, f, p, q, t;
  if (arguments.length === 1) {
    s = h.s, v = h.v, h = h.h;
  }
  i = Math.floor(h * 6);
  f = h * 6 - i;
  p = v * (1 - s);
  q = v * (1 - f * s);
  t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: r = v, g = t, b = p; break;
    case 1: r = q, g = v, b = p; break;
    case 2: r = p, g = v, b = t; break;
    case 3: r = p, g = q, b = v; break;
    case 4: r = t, g = p, b = v; break;
    case 5: r = v, g = p, b = q; break;
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
}

const States = {
  OnOff: function (s) {
    return !!(s && s.on);
  },
  Brightness: function (s) {
    return (s && s.bri && (s.bri * 100 / 254)) || 0;
  },
  ColorSettingTemperature: function (s) {
    return (s && s.ct && (1000000 / s.ct)) || 0;
  },
  ColorSettingHsv: function (st) {
    var h = (st && st.hue && st.hue / 182.5487) || 0;
    var s = (st && st.sat && (st.sat / 254));
    var v = (st && st.bri && (st.bri / 254));
    return { h, s, v };
  },
  ColorSettingRgb: function (s) {
    var { h, s, v } = States.ColorSettingHsv(s);
    var { r, g, b } = HSVtoRGB(h / 360, s, v);
    return { r, g, b };
  }
}

function HueBulb(id, api, light, device) {
  this.id = id;
  this.api = api;
  this.light = light;
  this.device = device;
  this.state = this.light.state;

  this.refresher = (err) => {
    this._refresh();
  }
}

HueBulb.prototype._refresh = function (cb) {
  this.api.lightStatus(this.id, function(err, result) {
    if (result && result.state) {
      var state = result.state;
      this.state = state;

      for (var stateGetter of this.device.events) {
        var newValue = States[stateGetter](state);
        // don't bother detecting if the state has not changed. denoising will be done
        // at the platform level. this is also necessary for external calls to
        // listen for set events, even if nothing has changed.
        deviceManager.onDeviceEvent(this.light.id, stateGetter, newValue)
      }
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

HueBulb.prototype.setLevel = function (level) {
  this.api.setLightState(this.id, lightState.create().brightness(level), this.refresher);
}

HueBulb.prototype.setTemperature = function (kelvin) {
  var mired = Math.round(1000000 / kelvin);
  this.api.setLightState(this.id, lightState.create().ct(mired), this.refresher);
}

HueBulb.prototype.setRgb = function (r, g, b) {
  this.api.setLightState(this.id, lightState.create().rgb(r, g, b), this.refresher);
}

HueBulb.prototype.setHsv = function (h, s, v) {
  this.api.setLightState(this.id, lightState.create().hsb(h, s * 100, v * 100), this.refresher);
}

HueBulb.prototype.isOn = function () {
  return States.OnOff(this.state);
};

HueBulb.prototype.getLevel = function () {
  return States.Brightness(this.state);;
}

HueBulb.prototype.getTemperatureMinK = function () {
  return Math.round(1 / (this.light.capabilities.control.ct.max) * 1000000);
}

HueBulb.prototype.getTemperatureMaxK = function () {
  return Math.round(1 / (this.light.capabilities.control.ct.min) * 1000000);
}

HueBulb.prototype.getRgb = function () {
  return States.ColorSettingRgb(this.state);
}

HueBulb.prototype.getHsv = function () {
  return States.ColorSettingHsv(this.state);
}

HueBulb.prototype.getTemperature = function () {
  return States.ColorSettingTemperature(this.state);
}

var bridgeId = scriptSettings.getString('bridgeId');
var bridgeAddress = scriptSettings.getString('bridgeAddress');;
if (!bridgeId) {
  log.i('No "bridgeId" was specified in Plugin Settings. Press the pair button on the Hue bridge.');
  log.i('Searching for Hue Bridge...');
}
else {
  var username = scriptSettings.getString(`user-${bridgeId}`);
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
    scriptSettings.putString('bridgeId', bridgeId);
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
  scriptSettings.putString('bridgeAddress', bridgeAddress);

  log.i(`Hue Bridges Found: ${bridgeId}`);
  log.i('Querying devices...');


  async function listDevices(host, username) {
    log.clearAlerts();

    var api = new HueApi(host, username);
    HueHub.api = api;
    try {
      var result = await api.lights();
      log.i(`lights: ${result}`);

      HueHub.updateLights(result);
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
      scriptSettings.putString(`user-${bridgeId}`, result);
      return listDevices(bridgeAddress, username);
    })
    .catch((e) => {
      log.a(`Unable to create user on bridge ${bridgeId}: ${e}`);
      log.a('You may need to press the pair button on the bridge.');
    })
    .done();
};

// --------------------------
// Using a promise
hue.nupnpSearch().then(displayBridges);


export default HueHub;
